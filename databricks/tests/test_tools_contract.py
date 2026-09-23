"""Cross-cutting contract tests: the `{ok, data|error}` envelope shape (DEVELOPMENT.md §9/§11)
and MCP tool name parity against PLAN.md §2.7.
"""

from __future__ import annotations

import pytest
from docintel_app.schemas import err_result, ok_result
from docintel_app.server import health, register_tools
from fakes import make_deps
from mcp.server.mcpserver import MCPServer

EXPECTED_TOOL_NAMES = {
    "ingest_pdf",
    "extract_pdf_text",
    "enrich_document",
    "persist_document_result",
    "get_document_result",
    "run_pdf_agent",
    "get_pdf_run_status",
    "health",
}


def test_ok_result_shape() -> None:
    assert ok_result({"a": 1}) == {"ok": True, "data": {"a": 1}}


def test_err_result_shape() -> None:
    assert err_result("boom", "it broke") == {
        "ok": False,
        "error": {"code": "boom", "message": "it broke"},
    }


@pytest.mark.anyio
async def test_registered_tool_names_match_plan_2_7() -> None:
    """Every tool name in PLAN.md §2.7 must be registered, and no extras."""
    deps = make_deps()
    mcp_server = MCPServer(name="docintel-pdf-agent")
    register_tools(mcp_server, deps)

    tools = await mcp_server.list_tools()
    names = {tool.name for tool in tools}

    assert names == EXPECTED_TOOL_NAMES


@pytest.mark.anyio
async def test_health_tool_returns_ok() -> None:
    assert await health() == {"ok": True, "data": {"status": "ok"}}
