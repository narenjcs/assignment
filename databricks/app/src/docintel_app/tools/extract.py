"""`extract_pdf_text` MCP tool: pypdf text extraction with an `ai_parse_document` OCR fallback."""

from __future__ import annotations

import asyncio
import io
import json
from typing import Any

from databricks.sdk.service.sql import StatementParameterListItem
from pypdf import PdfReader

from docintel_app import uc
from docintel_app.deps import Deps
from docintel_app.schemas import ok_result
from docintel_app.tools import ToolFn, guarded

# ai_parse_document v2.0 element types that carry real document text. Layout-only types
# (page_header, page_footer, page_number) and figure (content may be null / an image ref) are
# dropped.
_KEPT_ELEMENT_TYPES = frozenset({"text", "title", "section_header", "caption", "footnote", "table"})


def build_extract_pdf_text(deps: Deps) -> ToolFn:
    """Build the `extract_pdf_text` tool, closing over `deps`."""

    @guarded
    async def extract_pdf_text(volume_path: str) -> dict[str, Any]:
        """Extract text from the PDF at `volume_path` in the UC inbox volume.

        Tries `pypdf` first; falls back to the `ai_parse_document` SQL function (v2.0 output
        shape, PLAN.md-reviewed) on the serverless warehouse for OCR only when pypdf found no
        pages at all, or found pages but no text (a scanned/image-only PDF) — not merely a
        short page count, so a legitimate short one-pager isn't forced through OCR. Any
        `error_status` entries `ai_parse_document` reports are surfaced as `warnings`.
        """
        # `uc.download_from_volume` and (below) `_extract_with_ai_parse_document` are blocking
        # calls — the latter includes `uc.run_statement`'s own `time.sleep` poll loop — so both
        # run on a worker thread; one PDF job must not stall `/api/health` and other MCP calls.
        content = await asyncio.to_thread(uc.download_from_volume, deps.workspace, volume_path)
        text, page_count = _extract_with_pypdf(content)
        method = "pypdf"
        warnings: list[str] = []
        if page_count == 0 or not text.strip():
            text, page_count, warnings = await asyncio.to_thread(
                _extract_with_ai_parse_document, deps, volume_path
            )
            method = "ai_parse_document"
        result: dict[str, Any] = {
            "text": text,
            "page_count": page_count,
            "word_count": len(text.split()),
            "extraction_method": method,
        }
        if warnings:
            result["warnings"] = warnings
        return ok_result(result)

    return extract_pdf_text


def _extract_with_pypdf(content: bytes) -> tuple[str, int]:
    """Return (joined page text, page count) via pypdf, tolerating unreadable pages."""
    reader = PdfReader(io.BytesIO(content))
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return "\n".join(pages).strip(), len(reader.pages)


def _extract_with_ai_parse_document(deps: Deps, volume_path: str) -> tuple[str, int, list[str]]:
    """OCR fallback: run `ai_parse_document` v2.0 over the file via the serverless SQL warehouse.

    Requests the v2.0 output shape explicitly (`map('version', '2.0')`): since Sept 2025,
    `document.elements[]` holds the text (each with `id`, `type`, `content`, `bbox`), and
    `document.pages[]` only holds `id`/`image_uri` — nothing textual lives under `pages`
    any more. Returns (joined text, page count, warnings from `error_status`).
    """
    sql = (
        "SELECT ai_parse_document(content, map('version', '2.0')) AS parsed "
        "FROM READ_FILES(:volume_path, format => 'binaryFile')"
    )
    param = [StatementParameterListItem(name="volume_path", value=volume_path, type="STRING")]
    rows = uc.run_statement(deps.workspace, deps.settings.warehouse_id, sql, param)
    return _flatten_parsed_document(rows[0][0]) if rows else ("", 0, [])


def _flatten_parsed_document(raw_json: str) -> tuple[str, int, list[str]]:
    """Flatten an `ai_parse_document` v2.0 payload into (text, page_count, warnings).

    Keeps only text-bearing element types (see `_KEPT_ELEMENT_TYPES`; drops page headers/
    footers/page numbers and figures), groups the kept elements by `bbox[0].page_id`, orders
    elements within a page by `id`, and joins pages in `page_id` order. `page_count` is derived
    from `max(page_id) + 1` across *all* elements' bboxes (so a page that only has a header/
    footer still counts), falling back to `len(document.pages)` if no element carries a bbox.
    Each `error_status` entry becomes one warning string.
    """
    parsed = json.loads(raw_json)
    document = parsed.get("document", {})
    elements = document.get("elements", [])

    page_ids = [e["bbox"][0]["page_id"] for e in elements if e.get("bbox")]
    page_count = max(page_ids) + 1 if page_ids else len(document.get("pages", []))

    kept_by_page: dict[int, list[str]] = {}
    for element in sorted(elements, key=lambda e: e.get("id", 0)):
        content = element.get("content")
        if element.get("type") not in _KEPT_ELEMENT_TYPES or not content:
            continue
        page_id = element["bbox"][0]["page_id"] if element.get("bbox") else 0
        kept_by_page.setdefault(page_id, []).append(content)
    text = "\n\n".join("\n".join(kept_by_page[page_id]) for page_id in sorted(kept_by_page))

    warnings = [
        f"page {err.get('page_id')}: {err.get('error_message')}"
        for err in parsed.get("error_status", [])
    ]
    return text, page_count, warnings
