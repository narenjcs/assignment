"""`orchestrator/processors.py`: Strategy processors that route docx -> AWS and pdf -> Databricks,
in both sync and async modes (DEVELOPMENT.md §9 "Strategy pattern")."""

from __future__ import annotations

import pytest
from conftest import import_agent_module
from fakes import FakeToolBackend

processors = import_agent_module("orchestrator", "processors")

_FAST_POLL = processors.PollConfig(max_attempts=5, initial_interval_s=0.0, max_interval_s=0.0)


def test_aws_docx_processor_returns_result_on_success() -> None:
    def delegate(job_id: str, mode: str) -> dict:
        assert (job_id, mode) == ("job-1", "sync")
        return {"ok": True, "jobId": job_id, "result": {"summary": "ok"}}

    processor = processors.AwsDocxProcessor(delegate=delegate)
    assert processor.run({"jobId": "job-1"}, "sync") == {"summary": "ok"}


def test_aws_docx_processor_raises_on_delegate_failure() -> None:
    def delegate(job_id: str, mode: str) -> dict:
        return {"ok": False, "error": {"message": "runtime unavailable"}}

    processor = processors.AwsDocxProcessor(delegate=delegate)
    with pytest.raises(processors.ProcessorError, match="runtime unavailable"):
        processor.run({"jobId": "job-1"}, "sync")


def test_databricks_pdf_processor_sync_mode_returns_run_result_directly() -> None:
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {
            "run_pdf_agent": {
                "ok": True,
                "data": {"mode": "sync", "result": {"summary": "sync done"}},
            }
        }
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b)
    )

    result = processor.run({"jobId": "job-2", "fileName": "f.pdf"}, "sync")

    assert result == {"summary": "sync done"}
    assert aws_backend.calls[0][0] == "get_download_url"
    assert dbx_backend.calls[0][0] == "run_pdf_agent"
    assert dbx_backend.read_timeouts[0] == processors._SYNC_RUN_TIMEOUT_S


def test_databricks_pdf_processor_passes_download_url_from_tool_response() -> None:
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://signed/x"}}}
    )
    dbx_backend = FakeToolBackend(
        {"run_pdf_agent": {"ok": True, "data": {"mode": "sync", "result": {}}}}
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b)
    )

    processor.run({"jobId": "job-2b", "fileName": "f.pdf"}, "sync")

    run_call = next(c for c in dbx_backend.calls if c[0] == "run_pdf_agent")
    assert run_call[1]["download_url"] == "https://signed/x"


def test_databricks_pdf_processor_passes_source_s3_key_when_job_has_one() -> None:
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {"run_pdf_agent": {"ok": True, "data": {"mode": "sync", "result": {}}}}
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b)
    )

    processor.run({"jobId": "job-2c", "fileName": "f.pdf", "s3Key": "uploads/f.pdf"}, "sync")

    run_call = next(c for c in dbx_backend.calls if c[0] == "run_pdf_agent")
    assert run_call[1]["source_s3_key"] == "uploads/f.pdf"


def test_databricks_pdf_processor_async_mode_uses_ready_result_without_document_result() -> None:
    """PLAN §2.7: `get_pdf_run_status`'s SUCCESS `data.result` is already a ready camelCase
    `JobResult` - when it already carries `volumePath`, `get_document_result` must not be
    called at all."""
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {
            "run_pdf_agent": {
                "ok": True,
                "data": {"mode": "async", "run_id": 1, "state": "PENDING"},
            },
            "get_pdf_run_status": [
                {"ok": True, "data": {"run_id": 1, "state": "RUNNING"}},
                {
                    "ok": True,
                    "data": {
                        "run_id": 1,
                        "state": "SUCCESS",
                        "result": {"summary": "ok", "volumePath": "/Volumes/x"},
                    },
                },
            ],
        }
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b), poll=_FAST_POLL
    )

    result = processor.run({"jobId": "job-3", "fileName": "f.pdf"}, "async")

    assert result == {"summary": "ok", "volumePath": "/Volumes/x"}
    status_calls = [c for c in dbx_backend.calls if c[0] == "get_pdf_run_status"]
    assert len(status_calls) == 2
    assert status_calls[0][1]["run_id"] == 1
    assert not any(c[0] == "get_document_result" for c in dbx_backend.calls)
    assert dbx_backend.read_timeouts[0] == processors.DEFAULT_READ_TIMEOUT_S


def test_databricks_pdf_processor_async_mode_enriches_missing_volume_path() -> None:
    """When the ready result lacks `volumePath`, `get_document_result` is called only as an
    optional enrichment, and its snake_case `row.volume_path` is folded in - never the whole
    row, and never used to build the result itself."""
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {
            "run_pdf_agent": {
                "ok": True,
                "data": {"mode": "async", "run_id": 7, "state": "PENDING"},
            },
            "get_pdf_run_status": {
                "ok": True,
                "data": {"run_id": 7, "state": "SUCCESS", "result": {"summary": "ok"}},
            },
            "get_document_result": {
                "ok": True,
                "data": {"found": True, "row": {"volume_path": "/Volumes/enriched"}},
            },
        }
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b), poll=_FAST_POLL
    )

    result = processor.run({"jobId": "job-3b", "fileName": "f.pdf"}, "async")

    assert result == {"summary": "ok", "volumePath": "/Volumes/enriched"}
    assert any(c[0] == "get_document_result" for c in dbx_backend.calls)


def test_databricks_pdf_processor_async_mode_enrichment_skipped_when_not_found() -> None:
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {
            "run_pdf_agent": {
                "ok": True,
                "data": {"mode": "async", "run_id": 8, "state": "PENDING"},
            },
            "get_pdf_run_status": {
                "ok": True,
                "data": {"run_id": 8, "state": "SUCCESS", "result": {"summary": "ok"}},
            },
            "get_document_result": {"ok": True, "data": {"found": False}},
        }
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b), poll=_FAST_POLL
    )

    result = processor.run({"jobId": "job-3c", "fileName": "f.pdf"}, "async")

    assert result == {"summary": "ok"}


def test_databricks_pdf_processor_async_mode_raises_on_failed_state_without_fetching_result() -> (
    None
):
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {
            "run_pdf_agent": {
                "ok": True,
                "data": {"mode": "async", "run_id": 1, "state": "PENDING"},
            },
            "get_pdf_run_status": {
                "ok": True,
                "data": {"run_id": 1, "state": "FAILED", "message": "OOM"},
            },
        }
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b), poll=_FAST_POLL
    )

    with pytest.raises(processors.ProcessorError, match="OOM"):
        processor.run({"jobId": "job-4", "fileName": "f.pdf"}, "async")

    status_calls = [c for c in dbx_backend.calls if c[0] == "get_pdf_run_status"]
    assert len(status_calls) == 1
    assert not any(c[0] == "get_document_result" for c in dbx_backend.calls)


def test_databricks_pdf_processor_async_mode_raises_when_success_has_no_result() -> None:
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {
            "run_pdf_agent": {
                "ok": True,
                "data": {"mode": "async", "run_id": 2, "state": "PENDING"},
            },
            "get_pdf_run_status": {"ok": True, "data": {"run_id": 2, "state": "SUCCESS"}},
        }
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b), poll=_FAST_POLL
    )

    with pytest.raises(processors.ProcessorError, match="succeeded without a result"):
        processor.run({"jobId": "job-5", "fileName": "f.pdf"}, "async")


def test_databricks_pdf_processor_async_mode_raises_when_polling_exhausted() -> None:
    aws_backend = FakeToolBackend(
        {"get_download_url": {"ok": True, "data": {"downloadUrl": "https://x"}}}
    )
    dbx_backend = FakeToolBackend(
        {
            "run_pdf_agent": {
                "ok": True,
                "data": {"mode": "async", "run_id": 3, "state": "PENDING"},
            },
            "get_pdf_run_status": {"ok": True, "data": {"run_id": 3, "state": "RUNNING"}},
        }
    )
    processor = processors.DatabricksPdfProcessor(
        aws_backend=aws_backend, databricks_backend=(lambda b=dbx_backend: b), poll=_FAST_POLL
    )

    with pytest.raises(processors.ProcessorError, match="did not finish"):
        processor.run({"jobId": "job-6", "fileName": "f.pdf"}, "async")

    status_calls = [c for c in dbx_backend.calls if c[0] == "get_pdf_run_status"]
    assert len(status_calls) == _FAST_POLL.max_attempts
