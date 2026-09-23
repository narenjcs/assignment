"""`docintel_common.events`: SSE frame builders match PLAN.md §2.6's exact contract shapes:

    {type:"status", ts, jobId, status, message?, source?, agent?}
    {type:"tool",   ts, jobId, name, phase:"start"|"end", source, agent?, summary?}
    {type:"token",  text, ts?}
    {type:"result", ts, jobId, result}
    {type:"error",  ts, jobId?, error:{code, message}}
    {type:"done",   ts, jobId?}

`ts` is dynamic (ISO-8601 UTC), so assertions check its format/parseability rather than an
exact string, and compare the rest of each frame by an explicit key set.
"""

from __future__ import annotations

from datetime import datetime

from docintel_common.events import (
    Actor,
    done_event,
    error_event,
    result_event,
    status_event,
    token_event,
    tool_event,
)


def _assert_iso8601_utc(ts: str) -> None:
    assert ts.endswith("Z")
    datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ")  # raises ValueError if malformed


def test_status_event_minimal_shape_has_exactly_the_required_keys() -> None:
    event = status_event("j1", "PROCESSING")
    assert event.keys() == {"type", "ts", "jobId", "status"}
    assert event["type"] == "status"
    assert event["jobId"] == "j1"
    assert event["status"] == "PROCESSING"
    _assert_iso8601_utc(event["ts"])


def test_status_event_includes_optional_fields_when_given() -> None:
    event = status_event("j1", "PROCESSING", "started", Actor(source="aws", agent="docx-agent"))
    assert event.keys() == {"type", "ts", "jobId", "status", "message", "source", "agent"}
    assert event["message"] == "started"
    assert event["source"] == "aws"
    assert event["agent"] == "docx-agent"


def test_tool_event_requires_source_and_exposes_exactly_those_keys() -> None:
    event = tool_event("j1", "AwsDocxProcessor", "start", Actor(source="aws"))
    assert event.keys() == {"type", "ts", "jobId", "name", "phase", "source"}
    assert event["type"] == "tool"
    assert event["source"] == "aws"
    _assert_iso8601_utc(event["ts"])


def test_tool_event_includes_agent_and_summary_when_given() -> None:
    actor = Actor(source="databricks", agent="orchestrator", summary="ran PDF pipeline")
    event = tool_event("j1", "DatabricksPdfProcessor", "end", actor)
    assert event.keys() == {"type", "ts", "jobId", "name", "phase", "source", "agent", "summary"}
    assert event["agent"] == "orchestrator"
    assert event["summary"] == "ran PDF pipeline"


def test_token_event_has_no_job_id_and_carries_text_plus_ts() -> None:
    event = token_event("hello")
    assert event.keys() == {"type", "text", "ts"}
    assert event["type"] == "token"
    assert event["text"] == "hello"
    _assert_iso8601_utc(event["ts"])


def test_result_event_carries_the_full_result_dict() -> None:
    result = {"summary": "s", "pageCount": 2}
    event = result_event("j1", result)
    assert event.keys() == {"type", "ts", "jobId", "result"}
    assert event["result"] == result


def test_error_event_nests_code_and_message_under_error() -> None:
    event = error_event("j1", "boom")
    assert event.keys() == {"type", "ts", "jobId", "error"}
    assert event["error"] == {"code": "INTERNAL", "message": "boom"}


def test_error_event_accepts_explicit_code() -> None:
    event = error_event("j1", "not found", code="NOT_FOUND")
    assert event["error"]["code"] == "NOT_FOUND"


def test_error_event_omits_job_id_when_none() -> None:
    event = error_event(None, "boom")
    assert event.keys() == {"type", "ts", "error"}


def test_done_event_with_job_id() -> None:
    event = done_event("j1")
    assert event.keys() == {"type", "ts", "jobId"}
    assert event["jobId"] == "j1"


def test_done_event_without_job_id_omits_it() -> None:
    event = done_event()
    assert event.keys() == {"type", "ts"}
