"""`persist_document_result` and `get_document_result` MCP tools: the UC `document_results`
table (PLAN.md §2.5).
"""

from __future__ import annotations

import asyncio
from typing import Any

from docintel_app import uc
from docintel_app.deps import Deps
from docintel_app.schemas import DocumentRow, ok_result
from docintel_app.tools import ToolFn, guarded


def build_persist_document_result(deps: Deps) -> ToolFn:
    """Build the `persist_document_result` tool, closing over `deps`."""

    @guarded
    async def persist_document_result(document: dict[str, Any]) -> dict[str, Any]:
        """Write one row to `document_results`, keyed by job_id (upsert; safe to re-run).

        `document` must contain `job_id`, `file_name`, `volume_path`, the `extract_pdf_text`
        result under `extraction`, and the `enrich_document` result under `enrichment`. It may
        optionally contain `source_s3_key`, `run_mode` ("sync" or "async"), and `run_id`.
        """
        row = _build_row(deps.settings.llm_endpoint, document)
        # `uc.persist_row` runs a blocking SQL statement (incl. its own poll loop); keep it off
        # the event loop so one PDF job doesn't stall `/api/health` and other MCP calls.
        await asyncio.to_thread(
            uc.persist_row, deps.workspace, deps.settings.warehouse_id, deps.settings.uc_table, row
        )
        return ok_result({"uc_table": deps.settings.uc_table})

    return persist_document_result


def build_get_document_result(deps: Deps) -> ToolFn:
    """Build the `get_document_result` tool, closing over `deps`."""

    @guarded
    async def get_document_result(job_id: str) -> dict[str, Any]:
        """Read back the persisted `document_results` row for `job_id`: `{found, row?}`
        (PLAN.md §2.7) — `found: false` (not an error envelope) when there is no row yet.
        """
        row = await asyncio.to_thread(
            uc.fetch_row, deps.workspace, deps.settings.warehouse_id, deps.settings.uc_table, job_id
        )
        if row is None:
            return ok_result({"found": False})
        return ok_result({"found": True, "row": row.model_dump(mode="json")})

    return get_document_result


def _build_row(model: str, document: dict[str, Any]) -> DocumentRow:
    """Map the `persist_document_result` input dict onto a `DocumentRow`."""
    extraction = document.get("extraction", {})
    enrichment = document.get("enrichment", {})
    text = extraction.get("text") or ""
    return DocumentRow(
        job_id=document["job_id"],
        file_name=document.get("file_name"),
        source_s3_key=document.get("source_s3_key"),
        volume_path=document.get("volume_path"),
        page_count=extraction.get("page_count"),
        word_count=extraction.get("word_count"),
        char_count=len(text),
        extraction_method=extraction.get("extraction_method"),
        extracted_text=extraction.get("text"),
        summary=enrichment.get("summary"),
        key_points=enrichment.get("key_points", []),
        entities=enrichment.get("entities", []),
        topics=enrichment.get("topics", []),
        sentiment=enrichment.get("sentiment"),
        language=enrichment.get("language"),
        model=model,
        run_mode=document.get("run_mode", "sync"),
        run_id=document.get("run_id"),
    )
