"""`orchestrator/events.py`: `map_stream_event` (Strands `stream_async` event -> SSE dict)."""

from __future__ import annotations

from conftest import import_agent_module

events = import_agent_module("orchestrator", "events")


def test_text_delta_maps_to_token_event() -> None:
    tool_uses: dict[str, str] = {}
    mapped = events.map_stream_event("j1", {"data": "hello", "delta": {"text": "hello"}}, tool_uses)
    assert mapped.keys() == {"type", "text", "ts"}
    assert mapped["type"] == "token"
    assert mapped["text"] == "hello"


def test_tool_use_start_maps_to_tool_start_event_once() -> None:
    tool_uses: dict[str, str] = {}
    current = {"toolUseId": "t1", "name": "aws_get_job", "input": {}}
    first = events.map_stream_event("j1", {"current_tool_use": current}, tool_uses)
    second = events.map_stream_event("j1", {"current_tool_use": current}, tool_uses)

    assert first == {
        "type": "tool",
        "ts": first["ts"],
        "jobId": "j1",
        "name": "aws_get_job",
        "phase": "start",
        "source": "aws",
    }
    assert second is None
    assert tool_uses == {"t1": "aws_get_job"}


def test_tool_result_maps_to_tool_end_event_and_looks_up_name() -> None:
    tool_uses = {"t1": "dbx_run_pdf_agent"}
    mapped = events.map_stream_event("j1", {"tool_result": {"toolUseId": "t1"}}, tool_uses)

    assert mapped == {
        "type": "tool",
        "ts": mapped["ts"],
        "jobId": "j1",
        "name": "dbx_run_pdf_agent",
        "phase": "end",
        "source": "databricks",
    }
    assert tool_uses == {}


def test_tool_result_falls_back_to_tool_use_id_when_unknown() -> None:
    mapped = events.map_stream_event("j1", {"tool_result": {"toolUseId": "unknown"}}, {})
    assert mapped["name"] == "unknown"
    assert mapped["source"] == "orchestrator"


def test_unrelated_event_is_dropped() -> None:
    assert events.map_stream_event("j1", {"init_event_loop": True}, {}) is None


def test_empty_current_tool_use_is_ignored() -> None:
    assert events.map_stream_event("j1", {"current_tool_use": {}}, {}) is None
