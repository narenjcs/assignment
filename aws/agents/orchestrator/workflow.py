"""Deterministic driver: load a job, pick a processor by docType, run it, optionally stream a
synthesis, persist the result (DEVELOPMENT.md §9 "State machine", "Append-only event trace",
"Result objects"). The Strategy pattern in `processors.py` decides *which* pipeline runs; this
module enforces *when* each step happens and guarantees every failure ends in an `error` frame
followed by `done` (PLAN.md §2.6: `done` is always last).

PLAN.md §2.2/§2.7: the processor itself already calls `save_job_result` and marks the job
COMPLETED before returning (the DOCX agent and the Databricks PDF pipeline both do this, for
both `sync` and `async` modes) - `mode == "async"` skips the streaming synthesis entirely here
and simply forwards the processor's already-persisted result. `mode == "sync"` streams the
synthesis and re-saves the result with the accumulated text as `result.narrative` (an idempotent
COMPLETED -> COMPLETED overwrite, `jobs-state.ts`'s self-transition rule) so the LLM call has a
durable effect that `run_chat` can later ground on.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

from docintel_common import events as sse_events
from docintel_common.events import Actor
from docintel_common.mcp_backend import ToolBackend, require_ok
from docintel_common.text import truncate_message
from processors import Processor
from prompts import CHAT_PROMPT_TEMPLATE, SYNTHESIS_PROMPT_TEMPLATE

AGENT_NAME = "orchestrator"
StreamLlm = Callable[[str, str], AsyncIterator[dict]]

logger = logging.getLogger(__name__)


@dataclass
class WorkflowDeps:
    """Everything `run_job`/`run_chat` need, injected so tests use fakes (DEVELOPMENT.md §9)."""

    aws_backend: ToolBackend
    docx_processor: Processor
    pdf_processor: Processor
    stream_llm: StreamLlm


async def run_job(deps: WorkflowDeps, job_id: str, mode: str) -> AsyncIterator[dict]:
    """Run the full pipeline for `job_id`, yielding one SSE-shaped dict per step.

    Any failure (job lookup, the processor, synthesis, persistence) is caught here, marks the
    job FAILED, and emits an `error` frame; `done` always follows, success or failure.
    """
    try:
        async for sse in _run_steps(deps, job_id, mode):
            yield sse
    except Exception as exc:
        message = str(exc)
        logger.error("workflow failed", extra={"job_id": job_id, "error": message})
        _mark_failed(deps, job_id, message)
        yield sse_events.error_event(job_id, message)
    finally:
        yield sse_events.done_event(job_id)


async def run_chat(deps: WorkflowDeps, job_id: str, message: str) -> AsyncIterator[dict]:
    """Stream a chat answer grounded in the job's stored result (PLAN §2.2 step 7).

    Chat never mutates the job (no FAILED marking on error - there is nothing to roll back);
    any failure still emits an `error` frame followed by `done`, matching `run_job`'s contract.
    """
    try:
        async for sse in _run_chat_steps(deps, job_id, message):
            yield sse
    except Exception as exc:
        error_message = str(exc)
        logger.error("chat failed", extra={"job_id": job_id, "error": error_message})
        yield sse_events.error_event(job_id, error_message)
    finally:
        yield sse_events.done_event(job_id)


async def drain(deps: WorkflowDeps, job_id: str, mode: str) -> None:
    """Consume `run_job` fully, for the async-mode background task (no one is listening)."""
    async for _ in run_job(deps, job_id, mode):
        pass


async def _run_chat_steps(deps: WorkflowDeps, job_id: str, message: str) -> AsyncIterator[dict]:
    job = require_ok(deps.aws_backend.call("get_job", {"job_id": job_id}), "get_job")
    result = job.get("result") or {}
    prompt = CHAT_PROMPT_TEMPLATE.format(
        job_id=job_id, result_json=json.dumps(result), message=message
    )
    async for sse in deps.stream_llm(job_id, prompt):
        yield sse


async def _run_steps(deps: WorkflowDeps, job_id: str, mode: str) -> AsyncIterator[dict]:
    job = require_ok(deps.aws_backend.call("get_job", {"job_id": job_id}), "get_job")
    actor = Actor(source="orchestrator", agent=AGENT_NAME)
    yield sse_events.status_event(job_id, "PROCESSING", f"Routing {job.get('docType')} job", actor)
    _update_status(deps, job_id, "PROCESSING", "Workflow started")

    is_docx = job.get("docType") == "docx"
    processor = deps.docx_processor if is_docx else deps.pdf_processor
    name = type(processor).__name__
    processor_actor = Actor(source="aws" if is_docx else "databricks", agent=AGENT_NAME)
    yield sse_events.tool_event(job_id, name, "start", processor_actor)
    result = processor.run(job, mode)
    yield sse_events.tool_event(job_id, name, "end", processor_actor)

    if mode == "sync":
        async for sse in _synthesize_and_persist(deps, job_id, job, result):
            yield sse
    else:
        yield sse_events.result_event(job_id, result)


async def _synthesize_and_persist(
    deps: WorkflowDeps, job_id: str, job: dict, result: dict
) -> AsyncIterator[dict]:
    """Stream the synthesis prompt, fold the accumulated text into `result.narrative`
    (PLAN.md §2.4), re-save it, then yield the terminal `result` frame."""
    prompt = SYNTHESIS_PROMPT_TEMPLATE.format(
        job_id=job_id, file_name=job.get("fileName", ""), result_json=json.dumps(result)
    )
    narrative_parts: list[str] = []
    async for sse in deps.stream_llm(job_id, prompt):
        if sse.get("type") == "token":
            narrative_parts.append(str(sse.get("text", "")))
        yield sse
    result = {**result, "narrative": "".join(narrative_parts)}
    _save_result(deps, job_id, job, result)
    yield sse_events.result_event(job_id, result)


def _save_result(deps: WorkflowDeps, job_id: str, job: dict, result: dict) -> None:
    processor_name = job.get("processor") or _processor_tool_name(job)
    require_ok(
        deps.aws_backend.call(
            "save_job_result",
            {
                "job_id": job_id,
                "result_json": json.dumps(result),
                "processor": processor_name,
                "source": "orchestrator",
                "agent": AGENT_NAME,
            },
        ),
        "save_job_result",
    )


def _processor_tool_name(job: dict) -> str:
    return "aws-docx-agent" if job.get("docType") == "docx" else "databricks-pdf-agent"


def _update_status(deps: WorkflowDeps, job_id: str, status: str, message: str) -> None:
    require_ok(
        deps.aws_backend.call(
            "update_job_status",
            {
                "job_id": job_id,
                "status": status,
                "source": "orchestrator",
                "agent": AGENT_NAME,
                "message": truncate_message(message),
            },
        ),
        "update_job_status",
    )


def _mark_failed(deps: WorkflowDeps, job_id: str, message: str) -> None:
    """Best-effort FAILED status write: never raises, so a broken status call can't mask the
    original error event from the client (it's already logged loudly)."""
    try:
        _update_status(deps, job_id, "FAILED", message)
    except Exception:
        logger.error("failed to mark job FAILED", extra={"job_id": job_id})
