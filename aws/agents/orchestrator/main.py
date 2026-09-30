"""AgentCore entrypoint for the orchestrator (T4.2): sync/async/chat modes over one job
(PLAN.md §2.2). Verified against `bedrock_agentcore.BedrockAgentCoreApp.add_async_task(name,
metadata=None) -> int` / `.complete_async_task(task_id) -> bool` (bedrock-agentcore==1.23.1):
the async branch calls `add_async_task`, runs the workflow on a background thread and returns
`{"accepted": True, "jobId": ...}` immediately, without awaiting it.

Every entry path here guarantees an `error` + `done` frame (or, for async, a FAILED job status)
even when `workflow_session` itself fails - secrets lookup, token exchange, or MCP connect can
all raise before `run_job`/`run_chat`/`drain` ever start, and `workflow.py`'s own try/except
never runs in that case (it wraps `_run_steps`, not the session setup).
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import AsyncIterator, Coroutine
from typing import Any

from bedrock_agentcore import BedrockAgentCoreApp, RequestContext
from docintel_common import events as sse_events
from docintel_common.config import get_settings
from docintel_common.observability import elapsed_ms, log_event
from tools import mark_job_failed_best_effort, workflow_session
from workflow import drain, run_chat, run_job

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("orchestrator")

app = BedrockAgentCoreApp()
settings = get_settings()


@app.entrypoint
async def handler(payload: dict, context: RequestContext) -> dict | AsyncIterator[dict]:
    """Dispatch one job by `mode`: sync/chat stream SSE dicts, async returns immediately."""
    job_id = payload["jobId"]
    mode = payload.get("mode", "sync")
    log_event(
        logger,
        "orchestrator_invoked",
        job_id=job_id,
        mode=mode,
        session_id=context.session_id,
    )
    if mode == "async":
        task_id = app.add_async_task(f"workflow-{job_id}")
        _schedule_background(_run_background(job_id, task_id))
        return {"accepted": True, "jobId": job_id}
    if mode == "chat":
        return _chat_stream(job_id, str(payload.get("message", "")))
    return _sync_stream(job_id, mode)


def _schedule_background(coro: Coroutine[Any, Any, None]) -> None:
    """Fire-and-forget a coroutine on its own thread and event loop.

    Not `asyncio.create_task`: the SDK runs `handler` on a single worker loop and hands its
    return value back through a `call_soon` callback on that same loop. The workflow is blocking
    I/O (sync MCP client, boto3, `time.sleep` polling), so a task on that loop starved the
    callback and held the `accepted` response until the whole job finished (80 s for a PDF,
    seen on 2026-09-30 as `orchestrator_async_accepted` landing after `_completed`).
    """
    threading.Thread(target=asyncio.run, args=(coro,), daemon=True).start()


async def _sync_stream(job_id: str, mode: str) -> AsyncIterator[dict]:
    """Stream `run_job`'s SSE frames; if opening the session itself fails, still emit
    `error` then `done` (PLAN §2.6) and best-effort mark the job FAILED."""
    started_at = time.perf_counter()
    try:
        with workflow_session(settings) as deps:
            async for event in run_job(deps, job_id, mode):
                yield event
        log_event(
            logger,
            "orchestrator_sync_completed",
            job_id=job_id,
            mode=mode,
            duration_ms=elapsed_ms(started_at),
        )
    except Exception as exc:
        message = str(exc)
        mark_job_failed_best_effort(settings, job_id, message)
        log_event(
            logger,
            "orchestrator_sync_failed",
            level=logging.ERROR,
            job_id=job_id,
            mode=mode,
            duration_ms=elapsed_ms(started_at),
            error_type=type(exc).__name__,
            error=message,
        )
        yield sse_events.error_event(job_id, message)
        yield sse_events.done_event(job_id)


async def _chat_stream(job_id: str, message: str) -> AsyncIterator[dict]:
    """Stream `run_chat`'s SSE frames; a session failure still ends in `error` + `done`
    (chat never mutates job state, so there is nothing to mark FAILED)."""
    try:
        with workflow_session(settings) as deps:
            async for event in run_chat(deps, job_id, message):
                yield event
    except Exception as exc:
        error_message = str(exc)
        logger.error("chat session failed", extra={"job_id": job_id, "error": error_message})
        yield sse_events.error_event(job_id, error_message)
        yield sse_events.done_event(job_id)


async def _run_background(job_id: str, task_id: int) -> None:
    """Drain the async workflow; `complete_async_task` always runs, success or failure, so
    AgentCore never sees a task stuck open. A session-setup failure still marks the job FAILED,
    since `drain`/`run_job` never got a chance to (`workflow.py`'s try/except wraps `_run_steps`,
    not `workflow_session` itself).
    """
    started_at = time.perf_counter()
    try:
        try:
            with workflow_session(settings) as deps:
                await drain(deps, job_id, "async")
        except Exception as exc:
            message = str(exc)
            mark_job_failed_best_effort(settings, job_id, message)
            log_event(
                logger,
                "orchestrator_async_failed",
                level=logging.ERROR,
                job_id=job_id,
                duration_ms=elapsed_ms(started_at),
                error_type=type(exc).__name__,
                error=message,
            )
        else:
            log_event(
                logger,
                "orchestrator_async_completed",
                job_id=job_id,
                duration_ms=elapsed_ms(started_at),
            )
    finally:
        app.complete_async_task(task_id)


if __name__ == "__main__":
    app.run()
