"""FastAPI app: mounts the MCP streamable-HTTP server at `/mcp` and `/api/mcp`, plus two plain
REST endpoints. Wires together config, the Databricks/AWS clients, and every MCP tool.

Lifespan note (verified by reading Starlette 1.6.0's `routing.py` and the MCP SDK source):
mounting an MCP `Starlette` sub-app under FastAPI does **not** automatically run its lifespan —
`Mount.matches()` only handles `scope["type"] in ("http", "websocket")`, never `"lifespan"`. So
the session manager must be started explicitly, combined with FastAPI's own lifespan, exactly as
shown in `StreamableHTTPSessionManager.run`'s docstring. `streamable_http_app()` must be called
*before* `session_manager` is read (its property raises `RuntimeError` otherwise — see its
docstring), so `mcp_server.streamable_http_app(...)` runs first and `lifespan` closes over the
same `mcp_server` instance.

`build_app()` is a uvicorn factory (`uvicorn docintel_app.server:build_app --factory`), not a
module-level `app` object: constructing `Deps` calls `WorkspaceClient()` and authenticates, so it
must never run as an import side effect — tests import this module and call `build_app()` with
fakes instead.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer

from docintel_app import agent, uc
from docintel_app.config import Settings, load_settings
from docintel_app.deps import Deps, build_deps
from docintel_app.schemas import ok_result
from docintel_app.tools import ToolFn
from docintel_app.tools.enrich import build_enrich_document
from docintel_app.tools.extract import build_extract_pdf_text
from docintel_app.tools.ingest import build_ingest_pdf
from docintel_app.tools.persist import build_get_document_result, build_persist_document_result
from docintel_app.tools.runs import build_get_pdf_run_status, build_run_pdf_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def health() -> dict[str, Any]:
    """Liveness/readiness probe tool: no external calls, always returns ok."""
    return ok_result({"status": "ok"})


def register_tools(mcp_server: MCPServer, deps: Deps) -> None:
    """Register every MCP tool from PLAN.md §2.7 on `mcp_server`."""
    builders: dict[str, ToolFn] = {
        "ingest_pdf": build_ingest_pdf(deps),
        "extract_pdf_text": build_extract_pdf_text(deps),
        "enrich_document": build_enrich_document(deps),
        "persist_document_result": build_persist_document_result(deps),
        "get_document_result": build_get_document_result(deps),
        "run_pdf_agent": build_run_pdf_agent(deps),
        "get_pdf_run_status": build_get_pdf_run_status(deps),
        "health": health,
    }
    for name, fn in builders.items():
        mcp_server.add_tool(fn, name=name)


def build_app(settings: Settings | None = None, deps: Deps | None = None) -> FastAPI:
    """Build the FastAPI app. `settings`/`deps` exist for tests to inject fakes; the uvicorn
    factory entry point (`docintel_app.server:build_app`) calls this with neither.
    """
    settings = settings or load_settings()
    deps = deps or build_deps(settings)

    mcp_server = MCPServer(name="docintel-pdf-agent", instructions="DocIntel PDF agent tools.")
    register_tools(mcp_server, deps)
    mcp_app = mcp_server.streamable_http_app(
        streamable_http_path="/mcp", json_response=True, stateless_http=True
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        uc.ensure_table(deps.workspace, deps.settings.warehouse_id, deps.settings.uc_table)
        async with mcp_server.session_manager.run():
            yield

    app = FastAPI(lifespan=lifespan)

    @app.get("/api/health")
    async def api_health() -> dict[str, Any]:
        return await health()

    @app.post("/api/agent/run")
    async def api_agent_run(job: dict[str, Any]) -> dict[str, Any]:
        return await agent.run(deps, job)

    app.mount("/api", mcp_app)
    app.mount("/", mcp_app)
    return app
