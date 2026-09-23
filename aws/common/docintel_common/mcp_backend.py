"""Adapter over MCP clients so agents never know which cloud a tool lives in (DEVELOPMENT.md §9,
"Adapter over MCP clients"). `ToolBackend` is what `docx_agent/enrich.py` and the orchestrator's
`processors.py`/`workflow.py` depend on, instead of talking to `strands.tools.mcp.MCPClient`
directly, so unit tests substitute an in-memory fake with no network access. `gateway_client`
and `databricks_client` build (but do not open) the real `MCPClient`s used in production; callers
open them as context managers once per invocation, never at import time (DEVELOPMENT.md §12).

Verified against `strands.tools.mcp.MCPClient.__init__`/`.call_tool_sync` and
`strands.types.tools.ToolResult`/`ToolResultContent` (installed strands-agents==1.57.0):
`MCPClient(url=, headers=, prefix=, startup_timeout=)`; `call_tool_sync(tool_use_id, name,
arguments, read_timeout_seconds: datetime.timedelta | None = None) -> MCPToolResult` (a
`TypedDict` with `content: list[{json?, text?, ...}]`, `status: "success"|"error"`, optional
`structuredContent`).

Secret JSON shapes (Secrets Manager):
- `AWS_MCP_SECRET_ARN`    -> {"tokenUrl", "clientId", "clientSecret", "scope", "gatewayUrl"}
- `DATABRICKS_SECRET_ARN` -> {"host", "clientId", "clientSecret", "mcpUrl"}
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import timedelta
from itertools import count
from typing import Protocol, cast

from strands.tools.mcp import MCPClient

from . import auth
from .http import DEFAULT_TIMEOUT_S, RetryPolicy, retrying

ToolPayload = dict[str, object]
"""Owned, mutable payload shape returned by `ToolBackend.call`/`require_ok`."""

ToolPayloadIn = Mapping[str, object]
"""Read-only parameter shape: `Mapping` is covariant in its value type, so callers can pass any
concretely-typed dict literal (e.g. `dict[str, bool | dict[str, str]]`) without the invariance
mismatch `dict[str, object]` would trigger - see
https://docs.astral.sh/ty/reference/typing-faq/#invariant-generics.
"""

DEFAULT_READ_TIMEOUT_S = 120.0
"""Per-call MCP read timeout unless a caller asks for longer (e.g. a synchronous long-running
tool like `run_pdf_agent(mode="sync")`, which the caller passes explicitly)."""

_RETRY_ON_TRANSPORT_ERRORS = RetryPolicy(retry_on=(TimeoutError, ConnectionError, OSError))

IDEMPOTENT_READ_TOOLS = frozenset(
    {"get_job", "get_pdf_run_status", "get_document_result", "get_download_url", "list_jobs"}
)
"""Tool names safe to retry-on-transport-error: pure reads with no side effect, so a retry after
a dropped connection can never double-apply anything. Mutations (`update_job_status`,
`save_job_result`, `append_job_event`, `run_pdf_agent`, ...) are never retried here - the caller
owns their own idempotency (e.g. `save_job_result` is a same-status no-op, see jobs-state.ts),
and `run_pdf_agent` in particular must never be retried since it can trigger a second Databricks
job run or a second inline pipeline execution.
"""


class ToolBackend(Protocol):
    """Calls a named MCP tool and returns its parsed `{ok, data|error}` payload (PLAN §2.7)."""

    def call(
        self,
        name: str,
        args: ToolPayloadIn,
        *,
        read_timeout_seconds: float = DEFAULT_READ_TIMEOUT_S,
    ) -> ToolPayload:
        """Invoke tool `name` with `args`, returning the tool's JSON payload."""
        ...


class McpClientLike(Protocol):
    """The one `strands.tools.mcp.MCPClient` method `McpToolBackend` needs - a `Protocol` (not
    the concrete SDK class) so unit tests can substitute a plain in-memory fake.
    """

    def call_tool_sync(
        self,
        tool_use_id: str,
        name: str,
        arguments: dict[str, object],
        read_timeout_seconds: timedelta | None = None,
    ) -> Mapping[str, object]:
        """Invoke one MCP tool synchronously; returns an `MCPToolResult`-shaped mapping."""
        ...


class ToolCallError(RuntimeError):
    """Raised by `require_ok` when a tool call's payload has `ok: false`."""


def require_ok(payload: ToolPayloadIn, tool: str) -> ToolPayload:
    """Return `payload["data"]` (or `payload` itself if there is no `data` key).

    Raises `ToolCallError` if `payload["ok"]` is false.
    """
    if not payload.get("ok", False):
        raw_error = payload.get("error")
        if isinstance(raw_error, Mapping):
            error = cast("Mapping[str, object]", raw_error)
            message = error.get("message", "unknown error")
        elif raw_error is not None:
            message = str(raw_error)
        else:
            message = "unknown error"
        raise ToolCallError(f"{tool} failed: {message}")
    data = payload.get("data", payload)
    if isinstance(data, Mapping):
        return cast("ToolPayload", dict(data))
    return dict(payload)


class McpToolBackend:
    """`ToolBackend` over an already-open `strands.tools.mcp.MCPClient`.

    Retries on transport errors only for `IDEMPOTENT_READ_TOOLS`; every other tool (mutations,
    `run_pdf_agent`) is called at most once.
    """

    def __init__(self, client: McpClientLike) -> None:
        self._client = client
        self._ids = count(1)

    def call(
        self,
        name: str,
        args: ToolPayloadIn,
        *,
        read_timeout_seconds: float = DEFAULT_READ_TIMEOUT_S,
    ) -> ToolPayload:
        def _invoke() -> dict:
            tool_use_id = f"call-{next(self._ids)}"
            timeout = timedelta(seconds=read_timeout_seconds)
            return dict(self._client.call_tool_sync(tool_use_id, name, dict(args), timeout))

        if name in IDEMPOTENT_READ_TOOLS:
            raw = retrying(_invoke, _RETRY_ON_TRANSPORT_ERRORS)
        else:
            raw = _invoke()
        return _parse_tool_result(raw, name)


def _parse_tool_result(result: dict, tool: str) -> ToolPayload:
    """Parse one `MCPToolResult` into a `{ok, data|error}` payload.

    Raises `ToolCallError` (rather than letting it surface as a payload the caller has to
    remember to check) when the MCP call itself reports `status: "error"`, or when its text
    content isn't valid JSON - both are protocol-level failures, not `{ok: false}` application
    responses, so a bare `json.loads` `JSONDecodeError` must never escape here uncaught.
    """
    if result.get("status") == "error":
        raise ToolCallError(f"{tool} failed: {_error_text(result) or 'MCP tool reported an error'}")
    structured = result.get("structuredContent")
    if structured:
        return dict(structured)
    for block in result.get("content", []) or []:
        if block.get("json") is not None:
            return dict(block["json"])
        if block.get("text"):
            try:
                return json.loads(block["text"])
            except json.JSONDecodeError as exc:
                text = str(block["text"])[:200]
                raise ToolCallError(f"{tool} returned non-JSON content: {text!r}") from exc
    return {"ok": False, "error": {"code": "MCP_EMPTY", "message": "no content in tool result"}}


def _error_text(result: dict) -> str:
    """Pull a human-readable message out of an error-status `MCPToolResult`'s content blocks."""
    for block in result.get("content", []) or []:
        if block.get("text"):
            return str(block["text"])
    return ""


def gateway_client(gateway_url: str, secret: ToolPayloadIn, *, prefix: str = "aws") -> MCPClient:
    """Build (unopened) an `MCPClient` for the AWS Gateway, Cognito-bearer authenticated."""
    token = auth.cognito_m2m_token(
        str(secret["tokenUrl"]),
        str(secret["clientId"]),
        str(secret["clientSecret"]),
        str(secret["scope"]),
    )
    url = gateway_url or str(secret.get("gatewayUrl", ""))
    return MCPClient(
        url=url,
        headers={"Authorization": f"Bearer {token}"},
        prefix=prefix,
        startup_timeout=int(DEFAULT_TIMEOUT_S),
    )


def databricks_client(secret: ToolPayloadIn, *, prefix: str = "dbx") -> MCPClient:
    """Build (unopened) an `MCPClient` for the Databricks MCP App, OAuth M2M authenticated."""
    token = auth.databricks_m2m_token(
        str(secret["host"]), str(secret["clientId"]), str(secret["clientSecret"])
    )
    return MCPClient(
        url=str(secret["mcpUrl"]),
        headers={"Authorization": f"Bearer {token}"},
        prefix=prefix,
        startup_timeout=int(DEFAULT_TIMEOUT_S),
    )
