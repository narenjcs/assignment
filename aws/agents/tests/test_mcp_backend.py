"""`docintel_common.mcp_backend`: `require_ok` and `McpToolBackend`/`_parse_tool_result`.

`FakeMcpClient` stands in for `strands.tools.mcp.MCPClient`: only `call_tool_sync(tool_use_id,
name, arguments, read_timeout_seconds)` is exercised by `McpToolBackend`, matching the verified
signature in `mcp_backend.py`'s module docstring.
"""

from __future__ import annotations

from datetime import timedelta
from typing import cast

import pytest
from docintel_common.mcp_backend import (
    DEFAULT_READ_TIMEOUT_S,
    McpToolBackend,
    ToolCallError,
    require_ok,
)


class FakeMcpClient:
    """Returns one scripted `MCPToolResult`-shaped dict per call, in order."""

    def __init__(self, results: list[dict]) -> None:
        self._results = results
        self.calls: list[tuple[str, str, dict]] = []
        self.timeouts: list[timedelta | None] = []

    def call_tool_sync(
        self,
        tool_use_id: str,
        name: str,
        arguments: dict,
        read_timeout_seconds: timedelta | None = None,
    ) -> dict:
        self.calls.append((tool_use_id, name, arguments))
        self.timeouts.append(read_timeout_seconds)
        return self._results[len(self.calls) - 1]


def test_require_ok_returns_data_when_present() -> None:
    payload = {"ok": True, "data": {"jobId": "j1", "status": "COMPLETED"}}
    assert require_ok(payload, "get_job") == {"jobId": "j1", "status": "COMPLETED"}


def test_require_ok_returns_payload_when_no_data_key() -> None:
    payload = {"ok": True, "jobId": "j1"}
    assert require_ok(payload, "get_job") == payload


def test_require_ok_raises_on_not_ok_with_message() -> None:
    payload = {"ok": False, "error": {"code": "NOT_FOUND", "message": "job missing"}}
    with pytest.raises(ToolCallError, match="get_job failed: job missing"):
        require_ok(payload, "get_job")


def test_require_ok_raises_with_fallback_message_when_error_missing() -> None:
    with pytest.raises(ToolCallError, match="unknown error"):
        require_ok({"ok": False}, "get_job")


def test_mcp_tool_backend_parses_structured_content() -> None:
    client = FakeMcpClient([{"structuredContent": {"ok": True, "data": {"x": 1}}}])
    backend = McpToolBackend(client)
    assert backend.call("get_job", {"job_id": "j1"}) == {"ok": True, "data": {"x": 1}}
    assert [c[:2] for c in client.calls] == [("call-1", "get_job")]
    assert client.calls[0][2] == {"job_id": "j1"}


def test_mcp_tool_backend_parses_json_content_block() -> None:
    client = FakeMcpClient([{"content": [{"json": {"ok": True, "data": {"y": 2}}}]}])
    backend = McpToolBackend(client)
    assert backend.call("get_job", {}) == {"ok": True, "data": {"y": 2}}


def test_mcp_tool_backend_parses_text_content_block_as_json() -> None:
    client = FakeMcpClient([{"content": [{"text": '{"ok": true, "data": {"z": 3}}'}]}])
    backend = McpToolBackend(client)
    assert backend.call("get_job", {}) == {"ok": True, "data": {"z": 3}}


def test_mcp_tool_backend_raises_on_non_json_text_content() -> None:
    client = FakeMcpClient([{"content": [{"text": "not json at all"}]}])
    backend = McpToolBackend(client)
    with pytest.raises(ToolCallError, match="non-JSON content"):
        backend.call("get_job", {})


def test_mcp_tool_backend_raises_on_error_status() -> None:
    client = FakeMcpClient([{"status": "error", "content": [{"text": "boom"}]}])
    backend = McpToolBackend(client)
    with pytest.raises(ToolCallError, match="get_job failed: boom"):
        backend.call("get_job", {})


def test_mcp_tool_backend_returns_error_payload_when_content_empty() -> None:
    client = FakeMcpClient([{"content": []}])
    backend = McpToolBackend(client)
    result = backend.call("get_job", {})
    assert result["ok"] is False
    error = cast("dict[str, object]", result["error"])
    assert error["code"] == "MCP_EMPTY"


def test_mcp_tool_backend_uses_incrementing_tool_use_ids() -> None:
    client = FakeMcpClient(
        [
            {"structuredContent": {"ok": True, "data": {}}},
            {"structuredContent": {"ok": True, "data": {}}},
        ]
    )
    backend = McpToolBackend(client)
    backend.call("get_job", {})
    backend.call("get_job", {})
    assert [c[0] for c in client.calls] == ["call-1", "call-2"]


def test_mcp_tool_backend_passes_default_read_timeout_as_timedelta() -> None:
    client = FakeMcpClient([{"structuredContent": {"ok": True, "data": {}}}])
    backend = McpToolBackend(client)
    backend.call("get_job", {})
    assert client.timeouts == [timedelta(seconds=DEFAULT_READ_TIMEOUT_S)]


def test_mcp_tool_backend_passes_explicit_read_timeout_as_timedelta() -> None:
    client = FakeMcpClient([{"structuredContent": {"ok": True, "data": {}}}])
    backend = McpToolBackend(client)
    backend.call("run_pdf_agent", {}, read_timeout_seconds=600.0)
    assert client.timeouts == [timedelta(seconds=600.0)]


def test_mcp_tool_backend_retries_transport_errors_for_idempotent_read_tools() -> None:
    class FlakyClient:
        def __init__(self) -> None:
            self.attempts = 0

        def call_tool_sync(
            self,
            tool_use_id: str,
            name: str,
            arguments: dict,
            read_timeout_seconds: timedelta | None = None,
        ) -> dict:
            self.attempts += 1
            if self.attempts < 2:
                raise ConnectionError("flaky")
            return {"structuredContent": {"ok": True, "data": {}}}

    backend = McpToolBackend(FlakyClient())
    assert backend.call("get_job", {}) == {"ok": True, "data": {}}


@pytest.mark.parametrize("tool_name", ["update_job_status", "save_job_result", "run_pdf_agent"])
def test_mcp_tool_backend_never_retries_mutations(tool_name: str) -> None:
    class FlakyClient:
        def __init__(self) -> None:
            self.attempts = 0

        def call_tool_sync(
            self,
            tool_use_id: str,
            name: str,
            arguments: dict,
            read_timeout_seconds: timedelta | None = None,
        ) -> dict:
            self.attempts += 1
            raise ConnectionError("flaky")

    client = FlakyClient()
    backend = McpToolBackend(client)
    with pytest.raises(ConnectionError):
        backend.call(tool_name, {})
    assert client.attempts == 1
