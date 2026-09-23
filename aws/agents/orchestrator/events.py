"""Maps Strands `Agent.stream_async` events to SSE dicts (PLAN.md §2.6), via
`docintel_common.events`. Verified against `strands.types._events` (strands-agents==1.57.0):
`TextStreamEvent` -> `{"data": text, ...}`; `ToolUseStreamEvent` -> `{"type": "tool_use_stream",
"current_tool_use": {"toolUseId", "name", "input"}, ...}` (repeats per input delta, same
toolUseId); `ToolResultEvent` -> `{"type": "tool_result", "tool_result": {"toolUseId", ...}}`.
Only text deltas and tool start/end are forwarded to the client; everything else (init,
reasoning, metadata) is dropped.
"""

from __future__ import annotations

from docintel_common.events import Actor, token_event, tool_event

ToolUseTracker = dict[str, str]


def map_stream_event(job_id: str, event: dict, tool_uses: ToolUseTracker) -> dict | None:
    """Return one SSE dict for a Strands stream event, or `None` if it should be dropped.

    `tool_uses` is caller-owned (fresh per stream) so a tool's "end" event can look its name
    back up by `toolUseId` without any hidden module-level state (DEVELOPMENT.md §9 no
    singletons with mutable state).
    """
    if event.get("data"):
        return token_event(str(event["data"]))
    started = _map_tool_start(job_id, event, tool_uses)
    if started is not None:
        return started
    return _map_tool_end(job_id, event, tool_uses)


def _tool_source(name: str) -> str:
    """Infer PLAN.md §2.6's `source` from the MCP prefix (`aws_...`/`dbx_...`), verified
    against `MCPClient.list_tools_sync`'s `f"{effective_prefix}_{tool.name}"` naming
    (strands-agents==1.57.0); anything else is a local orchestrator tool.
    """
    if name.startswith("aws_"):
        return "aws"
    if name.startswith("dbx_"):
        return "databricks"
    return "orchestrator"


def _map_tool_start(job_id: str, event: dict, tool_uses: ToolUseTracker) -> dict | None:
    current = event.get("current_tool_use")
    if not current or not current.get("name"):
        return None
    tool_use_id = str(current.get("toolUseId", current["name"]))
    if tool_use_id in tool_uses:
        return None
    name = str(current["name"])
    tool_uses[tool_use_id] = name
    return tool_event(job_id, name, "start", Actor(source=_tool_source(name)))


def _map_tool_end(job_id: str, event: dict, tool_uses: ToolUseTracker) -> dict | None:
    tool_result = event.get("tool_result")
    if not tool_result:
        return None
    tool_use_id = str(tool_result.get("toolUseId", ""))
    name = tool_uses.pop(tool_use_id, tool_use_id)
    return tool_event(job_id, name, "end", Actor(source=_tool_source(name)))
