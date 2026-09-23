"""Unit tests for `agent.run`: the happy path (including `source_s3_key` propagation through to
the persisted row) and the failure path (a step failing reports FAILED to AWS instead of raising).

`ingest_pdf`'s real `uc.download_pdf` and `extract_pdf_text`'s real pypdf parsing are monkeypatched
out so no network call or real PDF bytes are needed.
"""

from __future__ import annotations

import pytest
from docintel_app import agent
from docintel_app.tools import extract as extract_mod
from docintel_app.tools import ingest as ingest_mod
from fakes import make_deps

_VALID_ENRICHMENT_JSON = (
    '{"summary": "s", "key_points": ["a"], "entities": [], "topics": ["t"], '
    '"sentiment": "neutral", "language": "en"}'
)


@pytest.mark.anyio
async def test_run_happy_path_propagates_source_s3_key(monkeypatch: pytest.MonkeyPatch) -> None:
    # Any non-empty text with page_count > 0 stays on the pypdf path instead of triggering the
    # ai_parse_document OCR fallback (see test_extract.py).
    dense_text = "hello world " * 20
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"pdf-bytes")
    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", lambda content: (dense_text, 1))

    deps = make_deps(llm_responses=[_VALID_ENRICHMENT_JSON])
    job = {
        "job_id": "job-1",
        "download_url": "https://s3.example/a.pdf",
        "file_name": "a.pdf",
        "source_s3_key": "uploads/a.pdf",
    }

    result = await agent.run(deps, job)

    assert result["ok"] is True
    merge_statement, merge_params = deps.workspace.statement_execution.calls[-1]
    assert merge_statement.strip().upper().startswith("MERGE INTO")
    params_by_name = {p.name: p.value for p in merge_params}
    assert params_by_name["source_s3_key"] == "uploads/a.pdf"
    assert params_by_name["char_count"] == str(len(dense_text))

    statuses = [args["status"] for name, args in deps.aws.calls if name == "update_job_status"]
    assert statuses == ["PROCESSING", "COMPLETED"]
    assert sum(1 for name, _ in deps.aws.calls if name == "save_job_result") == 1


@pytest.mark.anyio
async def test_run_reports_failed_status_when_a_step_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"pdf-bytes")

    def _boom(content: bytes) -> tuple[str, int]:
        raise RuntimeError("corrupt pdf")

    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", _boom)

    deps = make_deps()
    job = {"job_id": "job-2", "download_url": "https://s3.example/b.pdf", "file_name": "b.pdf"}

    result = await agent.run(deps, job)

    assert result["ok"] is False
    assert result["error"]["code"] == "agent_failed"
    statuses = [args["status"] for name, args in deps.aws.calls if name == "update_job_status"]
    assert statuses[-1] == "FAILED"
    assert sum(1 for name, _ in deps.aws.calls if name == "save_job_result") == 0


@pytest.mark.anyio
async def test_run_reports_failed_when_save_job_result_reports_ok_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Item 5: a `save_job_result` call that succeeds at the MCP transport level but returns
    `{ok: false}` (e.g. AWS's own write failed) must still surface as job status FAILED, not
    silently proceed to COMPLETED.
    """
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"pdf-bytes")
    dense_text = "hello world " * 20
    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", lambda content: (dense_text, 1))

    deps = make_deps(
        llm_responses=[_VALID_ENRICHMENT_JSON],
        aws_responses={
            "save_job_result": {
                "ok": False,
                "error": {"code": "boom", "message": "ddb write failed"},
            }
        },
    )
    job = {"job_id": "job-5", "download_url": "https://s3.example/e.pdf", "file_name": "e.pdf"}

    result = await agent.run(deps, job)

    assert result["ok"] is False
    assert result["error"]["code"] == "agent_failed"
    statuses = [args["status"] for name, args in deps.aws.calls if name == "update_job_status"]
    assert statuses[-1] == "FAILED"
