"""Unit tests for `tools.extract`: the pypdf vs `ai_parse_document` OCR fallback threshold."""

from __future__ import annotations

import json

import pytest
from docintel_app.tools import extract as extract_mod
from fakes import make_deps


@pytest.mark.anyio
async def test_extract_stays_on_pypdf_when_text_is_dense(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-empty pypdf text on a page-having doc must not trigger the OCR fallback."""
    deps = make_deps()
    dense_text = "word " * 100  # well over the 200 chars/page threshold for a 1-page doc
    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", lambda content: (dense_text, 1))

    def _fail_if_called(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("ai_parse_document fallback should not run for dense text")

    monkeypatch.setattr(extract_mod, "_extract_with_ai_parse_document", _fail_if_called)

    tool = extract_mod.build_extract_pdf_text(deps)
    result = await tool("/Volumes/docintel/docs/inbox/job-1_a.pdf")

    assert result["ok"] is True
    assert result["data"]["extraction_method"] == "pypdf"
    assert result["data"]["text"] == dense_text


@pytest.mark.anyio
async def test_extract_falls_back_to_ai_parse_document_for_sparse_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sparse/empty pypdf output (a scanned PDF) must trigger the `ai_parse_document` fallback."""
    deps = make_deps()
    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", lambda content: ("", 3))
    monkeypatch.setattr(
        extract_mod,
        "_extract_with_ai_parse_document",
        lambda deps, volume_path: ("ocr text", 3, []),
    )

    tool = extract_mod.build_extract_pdf_text(deps)
    result = await tool("/Volumes/docintel/docs/inbox/job-2_scan.pdf")

    assert result["ok"] is True
    assert result["data"]["extraction_method"] == "ai_parse_document"
    assert result["data"]["text"] == "ocr text"
    assert result["data"]["page_count"] == 3
    assert "warnings" not in result["data"]


@pytest.mark.anyio
async def test_extract_surfaces_ai_parse_document_warnings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`error_status` entries from the OCR fallback must show up as `warnings` in the result."""
    deps = make_deps()
    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", lambda content: ("", 1))
    monkeypatch.setattr(
        extract_mod,
        "_extract_with_ai_parse_document",
        lambda deps, volume_path: ("ocr text", 1, ["page 0: could not read page"]),
    )

    tool = extract_mod.build_extract_pdf_text(deps)
    result = await tool("/Volumes/docintel/docs/inbox/job-3_scan.pdf")

    assert result["data"]["warnings"] == ["page 0: could not read page"]


# ai_parse_document v2.0 fixture (Sept 2025 shape): text lives under document.elements[], not
# document.pages[]. Includes one page_footer element (must be dropped), one table element (must
# be kept, HTML content passed through as-is), and one error_status entry.
_V2_FIXTURE = {
    "document": {
        "pages": [{"id": 0, "image_uri": "s3://bucket/page-0.png"}],
        "elements": [
            {
                "id": 0,
                "type": "title",
                "content": "Quarterly Report",
                "bbox": [{"page_id": 0}],
            },
            {
                "id": 1,
                "type": "text",
                "content": "Revenue grew 10% year over year.",
                "bbox": [{"page_id": 0}],
            },
            {
                "id": 2,
                "type": "table",
                "content": "<table><tr><td>Q1</td><td>$1M</td></tr></table>",
                "bbox": [{"page_id": 0}],
            },
            {
                "id": 3,
                "type": "page_footer",
                "content": "Page 1 of 1",
                "bbox": [{"page_id": 0}],
            },
            {
                "id": 4,
                "type": "figure",
                "content": None,
                "bbox": [{"page_id": 0}],
            },
        ],
    },
    "error_status": [{"page_id": 0, "error_message": "low confidence OCR on figure"}],
}


def test_flatten_parsed_document_v2_keeps_text_types_drops_layout_and_figures() -> None:
    """`_flatten_parsed_document` follows the v2.0 `elements[]` shape: text/title/table kept,
    page_footer and figure (null content) dropped, error_status surfaced as a warning.
    """
    text, page_count, warnings = extract_mod._flatten_parsed_document(json.dumps(_V2_FIXTURE))

    assert text == (
        "Quarterly Report\nRevenue grew 10% year over year."
        "\n<table><tr><td>Q1</td><td>$1M</td></tr></table>"
    )
    assert "Page 1 of 1" not in text
    assert page_count == 1
    assert warnings == ["page 0: low confidence OCR on figure"]


def test_flatten_parsed_document_v2_orders_by_page_id_then_element_id() -> None:
    """Elements from a later page must not precede elements from an earlier page."""
    fixture = {
        "document": {
            "pages": [{"id": 0}, {"id": 1}],
            "elements": [
                {"id": 5, "type": "text", "content": "page two", "bbox": [{"page_id": 1}]},
                {"id": 0, "type": "text", "content": "page one", "bbox": [{"page_id": 0}]},
            ],
        },
        "error_status": [],
    }
    text, page_count, warnings = extract_mod._flatten_parsed_document(json.dumps(fixture))

    assert text == "page one\n\npage two"
    assert page_count == 2
    assert warnings == []
