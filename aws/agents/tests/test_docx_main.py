"""`docx_agent/main.py`: entrypoint wiring (secret fetch -> gateway_client -> run_docx_job ->
response mapping). Network boundaries (`secrets.get_secret_json`, `gateway_client`,
`_build_llm_call`, `run_docx_job`) are monkeypatched; `run_docx_job`'s own logic is covered by
test_docx_enrich.py, so this file only asserts `handler`'s dispatch and `_to_response` mapping.
"""

from __future__ import annotations

from contextlib import contextmanager

import pytest
from bedrock_agentcore import RequestContext
from conftest import import_agent_module, run_async

main = import_agent_module("docx_agent", "main")


@contextmanager
def _fake_gateway_client(gateway_url: str, secret: dict):
    yield object()


def test_handler_returns_result_response_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main.secrets, "get_secret_json", lambda arn, *, region: {"tokenUrl": "t"})
    monkeypatch.setattr(main, "gateway_client", _fake_gateway_client)
    monkeypatch.setattr(main, "_build_llm_call", lambda: lambda prompt: prompt)
    captured = {}

    async def fake_run_docx_job(backend: object, llm_call: object, job_id: str, model_id: str):
        captured["job_id"] = job_id
        captured["model_id"] = model_id
        return {"type": "result", "result": {"summary": "ok"}}

    monkeypatch.setattr(main, "run_docx_job", fake_run_docx_job)

    response = run_async(main.handler({"jobId": "job-1"}, RequestContext(session_id="s1")))

    assert response == {"ok": True, "jobId": "job-1", "result": {"summary": "ok"}}
    assert captured == {"job_id": "job-1", "model_id": main.settings.bedrock_model_id}


def test_handler_returns_error_response_when_job_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main.secrets, "get_secret_json", lambda arn, *, region: {})
    monkeypatch.setattr(main, "gateway_client", _fake_gateway_client)
    monkeypatch.setattr(main, "_build_llm_call", lambda: lambda prompt: prompt)

    async def fake_run_docx_job(backend: object, llm_call: object, job_id: str, model_id: str):
        return {"type": "error", "error": {"code": "INTERNAL", "message": "boom"}}

    monkeypatch.setattr(main, "run_docx_job", fake_run_docx_job)

    response = run_async(main.handler({"jobId": "job-2"}, RequestContext()))

    assert response == {
        "ok": False,
        "jobId": "job-2",
        "error": {"code": "INTERNAL", "message": "boom"},
    }
