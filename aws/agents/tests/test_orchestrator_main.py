"""`orchestrator/main.py`: mode dispatch. The async branch must return `{"accepted": True, ...}`
immediately, running the workflow on a background thread rather than awaiting it (main.py's own
docstring claim); sync/chat branches must return an async-iterable sourced from `run_job`/
`run_chat`. `workflow_session`/`run_job`/`run_chat`/`drain` are monkeypatched so no MCP client or
Bedrock model is ever constructed.

Also covers the case where `workflow_session` itself fails (secrets, tokens, MCP connect) before
`run_job`/`run_chat`/`drain` ever start - every mode must still end in `error` + `done` (sync/
chat) or a best-effort FAILED status write plus `complete_async_task` (async).
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator, Coroutine
from contextlib import contextmanager
from typing import Any

import pytest
from bedrock_agentcore import RequestContext
from conftest import import_agent_module, run_async

main = import_agent_module("orchestrator", "main")


@contextmanager
def _fake_workflow_session(settings: object):
    yield "deps-sentinel"


@contextmanager
def _raising_workflow_session(settings: object):
    raise RuntimeError("secrets exploded")
    yield  # pragma: no cover - unreachable, keeps this a generator function


def test_handler_async_mode_returns_accepted_then_drains_in_background(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    drained = threading.Event()

    async def fake_drain(deps: object, job_id: str, mode: str) -> None:
        assert deps == "deps-sentinel"
        drained.set()

    monkeypatch.setattr(main, "workflow_session", _fake_workflow_session)
    monkeypatch.setattr(main, "drain", fake_drain)

    response = run_async(main.handler({"jobId": "job-1", "mode": "async"}, RequestContext()))

    assert response == {"accepted": True, "jobId": "job-1"}
    assert drained.wait(timeout=2), "background workflow never ran"


def test_async_accept_is_not_held_by_a_blocking_workflow(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression (2026-09-30): mirrors the SDK's dispatch - `handler` runs on a worker loop in
    another thread and its result is read via `run_coroutine_threadsafe`. A blocking workflow on
    that loop used to hold the result until the job finished (80 s for a PDF)."""
    release = threading.Event()

    async def blocking_drain(deps: object, job_id: str, mode: str) -> None:
        release.wait(timeout=5)  # blocking, like the sync MCP client and `time.sleep` polling

    monkeypatch.setattr(main, "workflow_session", _fake_workflow_session)
    monkeypatch.setattr(main, "drain", blocking_drain)
    worker_loop = asyncio.new_event_loop()
    threading.Thread(target=worker_loop.run_forever, daemon=True).start()
    try:
        future = asyncio.run_coroutine_threadsafe(
            main.handler({"jobId": "job-1", "mode": "async"}, RequestContext()), worker_loop
        )
        assert future.result(timeout=1) == {"accepted": True, "jobId": "job-1"}
    finally:
        release.set()
        worker_loop.call_soon_threadsafe(worker_loop.stop)


def test_handler_sync_mode_streams_events_from_run_job(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_run_job(deps: object, job_id: str, mode: str) -> AsyncIterator[dict]:
        assert deps == "deps-sentinel"
        yield {"type": "status", "jobId": job_id, "status": "PROCESSING", "message": "m"}
        yield {"type": "done", "jobId": job_id}

    monkeypatch.setattr(main, "workflow_session", _fake_workflow_session)
    monkeypatch.setattr(main, "run_job", fake_run_job)

    async def scenario() -> list[dict]:
        result = await main.handler({"jobId": "job-5", "mode": "sync"}, RequestContext())
        return [event async for event in result]

    events = run_async(scenario())
    assert events[0]["status"] == "PROCESSING"
    assert events[-1] == {"type": "done", "jobId": "job-5"}


def test_handler_chat_mode_streams_events_from_run_chat(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_run_chat(deps: object, job_id: str, message: str) -> AsyncIterator[dict]:
        yield {"type": "token", "jobId": job_id, "text": message}
        yield {"type": "done", "jobId": job_id}

    monkeypatch.setattr(main, "workflow_session", _fake_workflow_session)
    monkeypatch.setattr(main, "run_chat", fake_run_chat)

    async def scenario() -> list[dict]:
        payload = {"jobId": "job-6", "mode": "chat", "message": "hi"}
        result = await main.handler(payload, RequestContext())
        return [event async for event in result]

    events = run_async(scenario())
    assert events[0] == {"type": "token", "jobId": "job-6", "text": "hi"}


def test_sync_stream_session_failure_emits_error_then_done_and_marks_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marked: list[tuple[object, str, str]] = []

    def fake_mark_failed(settings: object, job_id: str, message: str) -> None:
        marked.append((settings, job_id, message))

    monkeypatch.setattr(main, "workflow_session", _raising_workflow_session)
    monkeypatch.setattr(main, "mark_job_failed_best_effort", fake_mark_failed)

    events = run_async(_collect(main.handler({"jobId": "job-7", "mode": "sync"}, RequestContext())))

    assert events[-1]["type"] == "done"
    assert events[-2]["type"] == "error"
    assert "secrets exploded" in events[-2]["error"]["message"]
    assert marked and marked[0][1] == "job-7"


def test_chat_stream_session_failure_emits_error_then_done_without_marking_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = {"marked": False}

    def fake_mark_failed(settings: object, job_id: str, message: str) -> None:
        called["marked"] = True

    monkeypatch.setattr(main, "workflow_session", _raising_workflow_session)
    monkeypatch.setattr(main, "mark_job_failed_best_effort", fake_mark_failed)

    payload = {"jobId": "job-8", "mode": "chat", "message": "hi"}
    events = run_async(_collect(main.handler(payload, RequestContext())))

    assert events[-1]["type"] == "done"
    assert events[-2]["type"] == "error"
    assert called["marked"] is False


def test_run_background_marks_failed_and_completes_task_when_session_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marked: list[str] = []
    completed: list[int] = []

    def fake_mark_failed(settings: object, job_id: str, message: str) -> None:
        marked.append(job_id)

    def fake_complete_async_task(task_id: int) -> None:
        completed.append(task_id)

    monkeypatch.setattr(main, "workflow_session", _raising_workflow_session)
    monkeypatch.setattr(main, "mark_job_failed_best_effort", fake_mark_failed)
    monkeypatch.setattr(main.app, "complete_async_task", fake_complete_async_task)

    run_async(main._run_background("job-9", 7))

    assert marked == ["job-9"]
    assert completed == [7]


async def _collect(handler_coro: Coroutine[Any, Any, AsyncIterator[dict]]) -> list[dict]:
    stream = await handler_coro
    return [event async for event in stream]
