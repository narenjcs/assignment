"""SSE event builders shared by both agents.

The shapes here are PLAN.md §2.6's single source of truth (mirrored by `aws/lambdas`'s
stream-proxy and `frontend/src/types/sse.ts`), so agent code never hand-builds frame dicts. This
is the "Append-only event trace" pattern from DEVELOPMENT.md §9: every step in a job's life
emits one of these; `sse.frame()` then serialises it for the wire.

Exact required/optional keys per PLAN.md §2.6 (`?` = present only when given, `ts` is always an
ISO-8601 UTC timestamp):

    {type:"status", ts, jobId, status, message?, source?, agent?}
    {type:"tool",   ts, jobId, name, phase:"start"|"end", source, agent?, summary?}
    {type:"token",  text, ts?}
    {type:"result", ts, jobId, result}
    {type:"error",  ts, jobId?, error:{code, message}}
    {type:"done",   ts, jobId?}

`Actor` bundles the optional "who did this" / "what happened" fields so `status_event` and
`tool_event` stay within DEVELOPMENT.md's 4-parameter limit (an "options object", per its
quality rules) without losing per-field typing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from .sse import event

ToolPhase = Literal["start", "end"]
EventSource = Literal["aws", "databricks", "orchestrator"]


@dataclass(frozen=True)
class Actor:
    """Optional context for a status/tool event: who ran it and a short human summary.

    `source` is contractually required on `tool_event` (callers must pass a non-empty value)
    but optional on `status_event`; `summary` only applies to `tool_event`.
    """

    source: str = ""
    agent: str = ""
    summary: str = ""


_NO_ACTOR = Actor()


def _ts() -> str:
    """ISO-8601 UTC timestamp with millisecond precision and a `Z` suffix."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def status_event(job_id: str, status: str, message: str = "", actor: Actor = _NO_ACTOR) -> dict:
    """A job status transition (mirrors `update_job_status`'s `status` argument)."""
    fields: dict[str, str] = {"jobId": job_id, "status": status}
    if message:
        fields["message"] = message
    if actor.source:
        fields["source"] = actor.source
    if actor.agent:
        fields["agent"] = actor.agent
    return event("status", ts=_ts(), **fields)


def tool_event(job_id: str, name: str, phase: ToolPhase, actor: Actor) -> dict:
    """A tool call starting or finishing. `actor.source` is required by the contract."""
    fields: dict[str, str] = {"jobId": job_id, "name": name, "phase": phase}
    if actor.source:
        fields["source"] = actor.source
    if actor.agent:
        fields["agent"] = actor.agent
    if actor.summary:
        fields["summary"] = actor.summary
    return event("tool", ts=_ts(), **fields)


def token_event(text: str) -> dict:
    """One streamed text delta from the model. No `jobId` - the contract omits it."""
    return event("token", text=text, ts=_ts())


def result_event(job_id: str, result: dict) -> dict:
    """The final structured result (PLAN.md §2.4 `result` shape)."""
    return event("result", ts=_ts(), jobId=job_id, result=result)


def error_event(job_id: str | None, message: str, code: str = "INTERNAL") -> dict:
    """A terminal failure; always followed by a `done` frame."""
    fields: dict[str, object] = {"error": {"code": code, "message": message}}
    if job_id:
        fields["jobId"] = job_id
    return event("error", ts=_ts(), **fields)


def done_event(job_id: str | None = None) -> dict:
    """Marks the end of the stream; always the last frame sent."""
    fields: dict[str, str] = {}
    if job_id:
        fields["jobId"] = job_id
    return event("done", ts=_ts(), **fields)
