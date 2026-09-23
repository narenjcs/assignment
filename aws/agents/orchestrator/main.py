"""AgentCore entrypoint for the orchestrator (T4.2): sync/async/chat modes over one job
(PLAN.md §2.2). Verified against `bedrock_agentcore.BedrockAgentCoreApp.add_async_task(name,
metadata=None) -> int` / `.complete_async_task(task_id) -> bool` (bedrock-agentcore==1.23.1):
the async branch calls `add_async_task`, schedules the workflow as a background `asyncio` task
and returns `{"accepted": True, "jobId": ...}` immediately, without awaiting it.

Every entry path here guarantees an `error` + `done` frame (or, for async, a FAILED job status)
even when `workflow_session` itself fails - secrets lookup, token exchange, or MCP connect can
all raise before `run_job`/`run_chat`/`drain` ever start, and `workflow.py`'s own try/except
never runs in that case (it wraps `_run_steps`, not the session setup).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Coroutine
from typing import Any

from bedrock_agentcore import BedrockAgentCoreApp, RequestContext
from docintel_common import events as sse_events
from docintel_common.config import get_settings
from tools import mark_job_failed_best_effort, workflow_session
from workflow import drain, run_chat, run_job

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orchestrator")
_background_tasks: set[asyncio.Task] = set()

app = BedrockAgentCoreApp()
settings = get_settings()


@app.entrypoint
async def handler(payload: dict, context: RequestContext) -> dict | AsyncIterator[dict]:
    """Dispatch one job by `mode`: sync/chat stream SSE dicts, async returns immediately."""
    job_id = payload["jobId"]
    mode = payload.get("mode", "sync")
    logger.info(
        "orchestrator invoked",
        extra={"job_id": job_id, "mode": mode, "session_id": context.session_id},
    )
    if mode == "async":
        task_id = app.add_async_task(f"workflow-{job_id}")
        _schedule_background(_run_background(job_id, task_id))
        return {"accepted": True, "jobId": job_id}
    if mode == "chat":
        return _chat_stream(job_id, str(payload.get("message", "")))
    return _sync_stream(job_id, mode)


def _schedule_background(coro: Coroutine[Any, Any, None]) -> None:
    """Fire-and-forget a coroutine while keeping a strong reference until it completes.

    Without this, `asyncio` may garbage-collect an un-referenced task mid-flight.
    """
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _sync_stream(job_id: str, mode: str) -> AsyncIterator[dict]:
    """Stream `run_job`'s SSE frames; if opening the session itself fails, still emit
    `error` then `done` (PLAN §2.6) and best-effort mark the job FAILED."""
    try:
        with workflow_session(settings) as deps:
            async for event in run_job(deps, job_id, mode):
                yield event
    except Exception as exc:
        message = str(exc)
        logger.error("sync session failed", extra={"job_id": job_id, "error": message})
        mark_job_failed_best_effort(settings, job_id, message)
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
    try:
        try:
            with workflow_session(settings) as deps:
                await drain(deps, job_id, "async")
        except Exception as exc:
            message = str(exc)
            logger.error("async session failed", extra={"job_id": job_id, "error": message})
            mark_job_failed_best_effort(settings, job_id, message)
    finally:
        app.complete_async_task(task_id)


if __name__ == "__main__":
    app.run()
