"""Integration tests for `server.build_app`: REST routes wired with fully faked `Deps`, and that
the MCP streamable-HTTP mount boots without crashing. No network or real Databricks workspace is
touched — `build_app(settings=..., deps=...)` bypasses `build_deps()` (and its `WorkspaceClient()`
construction) entirely, which is exactly why `server.py` was designed as a `--factory` entry point
with no module-level `app` object.
"""

from __future__ import annotations

import pytest
from docintel_app.server import build_app
from docintel_app.tools import extract as extract_mod
from docintel_app.tools import ingest as ingest_mod
from fakes import make_deps, make_settings
from fastapi.testclient import TestClient

_VALID_ENRICHMENT_JSON = (
    '{"summary": "s", "key_points": [], "entities": [], "topics": [], '
    '"sentiment": "neutral", "language": "en"}'
)


def test_api_health() -> None:
    app = build_app(settings=make_settings(), deps=make_deps())

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"status": "ok"}}


def test_mcp_mount_boots_without_crashing() -> None:
    """Booting the app starts the MCP session manager's lifespan; a GET must not 500."""
    app = build_app(settings=make_settings(), deps=make_deps())

    with TestClient(app) as client:
        response = client.get("/mcp")

    assert response.status_code < 500


def test_api_agent_run_executes_the_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"pdf-bytes")
    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", lambda content: ("hello world", 1))

    deps = make_deps(llm_responses=[_VALID_ENRICHMENT_JSON])
    app = build_app(settings=make_settings(), deps=deps)
    job = {
        "job_id": "job-server-1",
        "download_url": "https://s3.example/a.pdf",
        "file_name": "a.pdf",
        "source_s3_key": "uploads/a.pdf",
    }

    with TestClient(app) as client:
        response = client.post("/api/agent/run", json=job)

    assert response.status_code == 200
    assert response.json()["ok"] is True
