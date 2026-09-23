"""Unit tests for `tools.persist`: SQL params for the new `source_s3_key`/`char_count` columns
(PLAN.md §2.5 scope addition) and the `persist_document_result`/`get_document_result` round trip.
"""

from __future__ import annotations

import pytest
from docintel_app.tools.persist import (
    _build_row,
    build_get_document_result,
    build_persist_document_result,
)
from fakes import make_deps

_ROW_VALUES = [
    "job-9",
    "doc.pdf",
    "uploads/doc.pdf",
    "/Volumes/docintel/docs/inbox/job-9_doc.pdf",
    "3",
    "120",
    "800",
    "pypdf",
    "hello world",
    "a summary",
    '["a", "b"]',
    '[{"name": "Acme", "type": "ORG"}]',
    '["t1"]',
    "neutral",
    "en",
    "databricks-gpt-oss-120b",
    "sync",
    None,
    "2026-09-23T12:00:00",
]


def test_build_row_computes_char_count_and_forwards_source_s3_key() -> None:
    document = {
        "job_id": "job-2",
        "source_s3_key": "uploads/b.pdf",
        "extraction": {"text": "1234567890"},
        "enrichment": {},
    }
    row = _build_row("model-x", document)

    assert row.char_count == 10
    assert row.source_s3_key == "uploads/b.pdf"


def test_build_row_char_count_is_zero_for_missing_text() -> None:
    row = _build_row("model-x", {"job_id": "job-3", "extraction": {}, "enrichment": {}})

    assert row.char_count == 0
    assert row.source_s3_key is None


@pytest.mark.anyio
async def test_persist_document_result_sends_new_columns_as_sql_params() -> None:
    deps = make_deps()
    tool = build_persist_document_result(deps)
    document = {
        "job_id": "job-1",
        "file_name": "a.pdf",
        "source_s3_key": "uploads/a.pdf",
        "volume_path": "/Volumes/docintel/docs/inbox/job-1_a.pdf",
        "extraction": {
            "text": "hello world",
            "page_count": 1,
            "word_count": 2,
            "extraction_method": "pypdf",
        },
        "enrichment": {
            "summary": "s",
            "key_points": [],
            "entities": [],
            "topics": [],
            "sentiment": "neutral",
            "language": "en",
        },
    }

    result = await tool(document)

    assert result["ok"] is True
    merge_statement, merge_params = deps.workspace.statement_execution.calls[-1]
    assert merge_statement.strip().upper().startswith("MERGE INTO")
    params_by_name = {p.name: p.value for p in merge_params}
    assert params_by_name["source_s3_key"] == "uploads/a.pdf"
    assert params_by_name["char_count"] == str(len("hello world"))


@pytest.mark.anyio
async def test_get_document_result_round_trips_new_columns() -> None:
    deps = make_deps(rows_by_prefix={"SELECT": [_ROW_VALUES]})
    tool = build_get_document_result(deps)

    result = await tool("job-9")

    assert result["ok"] is True
    assert result["data"]["found"] is True
    row = result["data"]["row"]
    assert row["source_s3_key"] == "uploads/doc.pdf"
    assert row["char_count"] == 800


@pytest.mark.anyio
async def test_get_document_result_not_found_returns_found_false() -> None:
    deps = make_deps(rows_by_prefix={"SELECT": []})
    tool = build_get_document_result(deps)

    result = await tool("missing-job")

    assert result["ok"] is True
    assert result["data"] == {"found": False}
