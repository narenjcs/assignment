"""`docx_agent/enrich.py`: extract -> enrich (validated, retried once) -> save.

Covers the "structured output + validated retry" behaviour and the "failure path sets FAILED +
emits an error event" requirement, using a `FakeToolBackend` and a scripted fake `LlmCall` -
no network, no real Bedrock/Strands call.
"""

from __future__ import annotations

from conftest import import_agent_module, run_async
from fakes import FakeToolBackend, fake_llm_call

enrich = import_agent_module("docx_agent", "enrich")

_EXTRACTED = {
    "ok": True,
    "data": {
        "text": "Hello world.",
        "pageCount": 2,
        "wordCount": 500,
        "extractionMethod": "mammoth",
    },
}

_VALID_JSON = (
    '{"summary": "A short summary.", "keyPoints": ["a"], "entities": [], "topics": [],'
    ' "sentiment": "positive", "language": "en", "pageCount": 2, "wordCount": 500,'
    ' "extractionMethod": "mammoth", "model": "openai.gpt-oss-120b-1:0"}'
)
_INVALID_JSON = '{"summary": ""}'


def _backend(extra: dict | None = None) -> FakeToolBackend:
    responses = {"extract_docx_text": _EXTRACTED}
    if extra:
        responses.update(extra)
    return FakeToolBackend(responses)


def test_run_docx_job_success_saves_result_and_returns_result_event() -> None:
    backend = _backend({"save_job_result": {"ok": True, "data": {}}})
    llm_call = fake_llm_call([_VALID_JSON])

    event = run_async(enrich.run_docx_job(backend, llm_call, "job-1", "openai.gpt-oss-120b-1:0"))

    assert event["type"] == "result"
    assert event["result"]["summary"] == "A short summary."
    save_calls = [c for c in backend.calls if c[0] == "save_job_result"]
    assert len(save_calls) == 1
    assert save_calls[0][1]["job_id"] == "job-1"
    status_calls = [c for c in backend.calls if c[0] == "update_job_status"]
    assert status_calls[0][1]["status"] == "PROCESSING"


def test_run_docx_job_retries_once_on_invalid_llm_output_then_succeeds() -> None:
    backend = _backend({"save_job_result": {"ok": True, "data": {}}})
    llm_call = fake_llm_call([_INVALID_JSON, _VALID_JSON])

    event = run_async(enrich.run_docx_job(backend, llm_call, "job-2", "m"))

    assert event["type"] == "result"


def test_run_docx_job_fails_after_two_invalid_llm_outputs_and_marks_job_failed() -> None:
    backend = _backend()
    llm_call = fake_llm_call([_INVALID_JSON, _INVALID_JSON])

    event = run_async(enrich.run_docx_job(backend, llm_call, "job-3", "m"))

    assert event["type"] == "error"
    status_calls = [c for c in backend.calls if c[0] == "update_job_status"]
    assert status_calls[-1][1]["status"] == "FAILED"
    assert status_calls[-1][1]["job_id"] == "job-3"


def test_run_docx_job_fails_when_extract_tool_reports_not_ok() -> None:
    backend = FakeToolBackend(
        {"extract_docx_text": {"ok": False, "error": {"message": "no such file"}}}
    )
    llm_call = fake_llm_call([_VALID_JSON])

    event = run_async(enrich.run_docx_job(backend, llm_call, "job-4", "m"))

    assert event["type"] == "error"
    assert "no such file" in event["error"]["message"]


def test_run_docx_job_fails_when_mark_processing_itself_reports_not_ok() -> None:
    """`_mark_processing` runs inside the try block: a failure there must still route through
    the same FAILED + error path as any other failure, not raise straight out of `run_docx_job`."""
    backend = _backend({"update_job_status": {"ok": False, "error": {"message": "job not found"}}})
    llm_call = fake_llm_call([_VALID_JSON])

    event = run_async(enrich.run_docx_job(backend, llm_call, "job-6", "m"))

    assert event["type"] == "error"
    assert "job not found" in event["error"]["message"]


def test_run_docx_job_fails_when_save_job_result_reports_not_ok() -> None:
    backend = _backend({"save_job_result": {"ok": False, "error": {"message": "schema rejected"}}})
    llm_call = fake_llm_call([_VALID_JSON])

    event = run_async(enrich.run_docx_job(backend, llm_call, "job-7", "m"))

    assert event["type"] == "error"
    assert "schema rejected" in event["error"]["message"]
    status_calls = [c for c in backend.calls if c[0] == "update_job_status"]
    assert status_calls[-1][1]["status"] == "FAILED"


def test_run_docx_job_truncates_long_failure_message() -> None:
    backend = FakeToolBackend(
        {"extract_docx_text": {"ok": False, "error": {"message": "x" * 5000}}}
    )
    llm_call = fake_llm_call([_VALID_JSON])

    run_async(enrich.run_docx_job(backend, llm_call, "job-8", "m"))

    status_calls = [c for c in backend.calls if c[0] == "update_job_status"]
    failed_message = status_calls[-1][1]["message"]
    assert len(failed_message) <= 1900
    assert failed_message.endswith("…")
