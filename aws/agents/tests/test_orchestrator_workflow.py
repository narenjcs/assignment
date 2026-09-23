"""`orchestrator/workflow.py`: routes a job to its processor by docType, and - only in `sync`
mode - streams a synthesis and re-persists it as `result.narrative`; guarantees every failure
emits `error` then `done`, and (for `run_job`) marks the job FAILED (DEVELOPMENT.md §9 "State
machine", "Append-only event trace")."""

from __future__ import annotations

from collections.abc import AsyncIterator

from conftest import import_agent_module, run_async
from fakes import FakeToolBackend

workflow = import_agent_module("orchestrator", "workflow")


class _FakeProcessor:
    def __init__(self, result: dict | None = None, error: Exception | None = None) -> None:
        self._result = result
        self._error = error
        self.calls: list[tuple[dict, str]] = []

    def run(self, job: dict, mode: str) -> dict:
        self.calls.append((job, mode))
        if self._error is not None:
            raise self._error
        return self._result or {}


async def _fake_stream_llm(job_id: str, prompt: str) -> AsyncIterator[dict]:
    yield {"type": "token", "text": "synth"}


async def _collect(agen: AsyncIterator[dict]) -> list[dict]:
    return [event async for event in agen]


def _deps(
    aws_backend: FakeToolBackend,
    docx_processor: _FakeProcessor | None = None,
    pdf_processor: _FakeProcessor | None = None,
) -> object:
    return workflow.WorkflowDeps(
        aws_backend=aws_backend,
        docx_processor=docx_processor or _FakeProcessor(result={}),
        pdf_processor=pdf_processor or _FakeProcessor(result={}),
        stream_llm=_fake_stream_llm,
    )


def test_run_job_sync_mode_streams_synthesis_and_persists_narrative() -> None:
    aws_backend = FakeToolBackend(
        {
            "get_job": {"ok": True, "data": {"docType": "docx", "fileName": "a.docx"}},
            "save_job_result": {"ok": True, "data": {}},
        }
    )
    docx = _FakeProcessor(result={"summary": "docx result"})
    pdf = _FakeProcessor(result={"summary": "pdf result"})
    deps = _deps(aws_backend, docx_processor=docx, pdf_processor=pdf)

    events = run_async(_collect(workflow.run_job(deps, "j1", "sync")))

    assert len(docx.calls) == 1
    assert len(pdf.calls) == 0
    assert events[-1]["type"] == "done"
    assert events[-1]["jobId"] == "j1"
    result_events = [e for e in events if e["type"] == "result"]
    assert result_events[0]["result"] == {"summary": "docx result", "narrative": "synth"}
    save_calls = [c for c in aws_backend.calls if c[0] == "save_job_result"]
    assert len(save_calls) == 1
    assert save_calls[0][1]["job_id"] == "j1"


def test_run_job_async_mode_skips_synthesis_and_does_not_resave() -> None:
    """`mode == 'async'`: the processor (Databricks/DOCX) already persisted the result and
    completed the job itself - `workflow.py` must not stream a synthesis or call
    `save_job_result` again."""
    aws_backend = FakeToolBackend({"get_job": {"ok": True, "data": {"docType": "pdf"}}})
    docx = _FakeProcessor(result={})
    pdf = _FakeProcessor(result={"summary": "pdf result"})
    deps = _deps(aws_backend, docx_processor=docx, pdf_processor=pdf)

    events = run_async(_collect(workflow.run_job(deps, "j2", "async")))

    assert len(pdf.calls) == 1
    assert len(docx.calls) == 0
    assert not any(e["type"] == "token" for e in events)
    assert events[-2]["type"] == "result"
    assert events[-2]["result"] == {"summary": "pdf result"}
    assert events[-1]["type"] == "done"
    assert not any(c[0] == "save_job_result" for c in aws_backend.calls)


def test_run_job_failure_sets_failed_status_and_emits_error_then_done() -> None:
    aws_backend = FakeToolBackend({"get_job": {"ok": True, "data": {"docType": "docx"}}})
    docx = _FakeProcessor(error=RuntimeError("delegate exploded"))
    deps = _deps(aws_backend, docx_processor=docx)

    events = run_async(_collect(workflow.run_job(deps, "j3", "sync")))

    assert events[-1]["type"] == "done"
    assert events[-1]["jobId"] == "j3"
    assert events[-2]["type"] == "error"
    assert "delegate exploded" in events[-2]["error"]["message"]
    status_calls = [c for c in aws_backend.calls if c[0] == "update_job_status"]
    assert status_calls[-1][1]["status"] == "FAILED"


def test_run_job_failure_truncates_long_message_before_marking_failed() -> None:
    aws_backend = FakeToolBackend({"get_job": {"ok": True, "data": {"docType": "docx"}}})
    long_message = "x" * 5000
    docx = _FakeProcessor(error=RuntimeError(long_message))
    deps = _deps(aws_backend, docx_processor=docx)

    run_async(_collect(workflow.run_job(deps, "j3b", "sync")))

    status_calls = [c for c in aws_backend.calls if c[0] == "update_job_status"]
    failed_message = status_calls[-1][1]["message"]
    assert len(failed_message) <= 1900
    assert failed_message.endswith("…")


def test_run_job_failure_when_save_job_result_reports_not_ok() -> None:
    """A `require_ok`-wrapped `save_job_result` failure (e.g. Zod validation) must still route
    through the same FAILED + error + done path as any other failure."""
    aws_backend = FakeToolBackend(
        {
            "get_job": {"ok": True, "data": {"docType": "docx"}},
            "save_job_result": {"ok": False, "error": {"message": "schema rejected"}},
        }
    )
    docx = _FakeProcessor(result={"summary": "docx result"})
    deps = _deps(aws_backend, docx_processor=docx)

    events = run_async(_collect(workflow.run_job(deps, "j3c", "sync")))

    assert events[-1]["type"] == "done"
    assert events[-2]["type"] == "error"
    assert "schema rejected" in events[-2]["error"]["message"]
    status_calls = [c for c in aws_backend.calls if c[0] == "update_job_status"]
    assert status_calls[-1][1]["status"] == "FAILED"


def test_run_chat_streams_from_stored_result_and_ends_with_done() -> None:
    aws_backend = FakeToolBackend({"get_job": {"ok": True, "data": {"result": {"summary": "s"}}}})
    deps = _deps(aws_backend)

    events = run_async(_collect(workflow.run_chat(deps, "j4", "What happened?")))

    assert events[0] == {"type": "token", "text": "synth"}
    assert events[-1]["type"] == "done"
    assert events[-1]["jobId"] == "j4"


def test_run_chat_failure_emits_error_then_done_without_marking_job_failed() -> None:
    aws_backend = FakeToolBackend({"get_job": {"ok": False, "error": {"message": "job not found"}}})
    deps = _deps(aws_backend)

    events = run_async(_collect(workflow.run_chat(deps, "j5", "hi")))

    assert events[-1]["type"] == "done"
    assert events[-2]["type"] == "error"
    assert "job not found" in events[-2]["error"]["message"]
    assert not any(c[0] == "update_job_status" for c in aws_backend.calls)
