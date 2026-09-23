"""Unit tests for `tools.runs`: `run_pdf_agent` (sync delegates to `agent.run`; async triggers
the Databricks job and filters `None` values, e.g. a missing `source_s3_key`, out of
`job_parameters` since the Jobs API requires `dict[str, str]`) and `get_pdf_run_status`
(PLAN.md §2.7 pinned cross-cloud shape: `mode`/`run_id`/`state` PENDING|RUNNING|SUCCESS|FAILED).
"""

from __future__ import annotations

import pytest
from docintel_app.tools import extract as extract_mod
from docintel_app.tools import ingest as ingest_mod
from docintel_app.tools.runs import build_get_pdf_run_status, build_run_pdf_agent
from fakes import FakeJobs, make_deps

_VALID_ENRICHMENT_JSON = (
    '{"summary": "s", "key_points": [], "entities": [], "topics": [], '
    '"sentiment": "neutral", "language": "en"}'
)


@pytest.mark.anyio
async def test_run_pdf_agent_sync_runs_the_pipeline_inline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"pdf-bytes")
    monkeypatch.setattr(extract_mod, "_extract_with_pypdf", lambda content: ("hello", 1))

    deps = make_deps(llm_responses=[_VALID_ENRICHMENT_JSON])
    tool = build_run_pdf_agent(deps)

    result = await tool("job-1", "https://s3.example/a.pdf", "a.pdf", "uploads/a.pdf")

    assert result["ok"] is True
    assert result["data"]["mode"] == "sync"
    assert result["data"]["result"]["summary"] == "s"
    assert deps.workspace.jobs.run_now_calls == []  # sync mode never triggers the Databricks job


@pytest.mark.anyio
async def test_run_pdf_agent_async_omits_missing_source_s3_key() -> None:
    deps = make_deps()
    tool = build_run_pdf_agent(deps)

    result = await tool("job-2", "https://s3.example/b.pdf", "b.pdf", mode="async")

    assert result["ok"] is True
    assert result["data"] == {"mode": "async", "run_id": 999, "state": "PENDING"}
    job_id, params = deps.workspace.jobs.run_now_calls[0]
    assert job_id == 42
    assert "source_s3_key" not in params
    assert params["job_id"] == "job-2"


@pytest.mark.anyio
async def test_run_pdf_agent_async_includes_source_s3_key_when_present() -> None:
    deps = make_deps()
    tool = build_run_pdf_agent(deps)

    await tool("job-3", "https://s3.example/c.pdf", "c.pdf", "uploads/c.pdf", mode="async")

    _, params = deps.workspace.jobs.run_now_calls[0]
    assert params["source_s3_key"] == "uploads/c.pdf"


@pytest.mark.anyio
async def test_run_pdf_agent_async_job_not_found() -> None:
    deps = make_deps()
    deps.workspace.jobs = FakeJobs(job_id=None)
    tool = build_run_pdf_agent(deps)

    result = await tool("job-4", "u", "f.pdf", mode="async")

    assert result["ok"] is False
    assert result["error"]["code"] == "job_not_found"


@pytest.mark.anyio
async def test_get_pdf_run_status_maps_terminated_success() -> None:
    deps = make_deps()
    tool = build_get_pdf_run_status(deps)

    result = await tool(999)

    assert result["ok"] is True
    assert result["data"]["run_id"] == 999
    assert result["data"]["state"] == "SUCCESS"
    assert result["data"]["message"] == "ok"


@pytest.mark.anyio
async def test_get_pdf_run_status_attaches_result_on_success() -> None:
    row_values = [
        "job-9",
        "doc.pdf",
        "uploads/doc.pdf",
        "/Volumes/docintel/docs/inbox/job-9_doc.pdf",
        "3",
        "120",
        "800",
        "pypdf",
        "hello world",
        "a summary",
        '["a", "b"]',
        "[]",
        '["t1"]',
        "neutral",
        "en",
        "databricks-gpt-oss-120b",
        "async",
        "999",
        "2026-09-23T12:00:00",
    ]
    deps = make_deps(rows_by_prefix={"SELECT": [row_values]})
    deps.workspace.jobs = FakeJobs(job_id=42, run_job_parameters={"job_id": "job-9"})
    tool = build_get_pdf_run_status(deps)

    result = await tool(999)

    assert result["ok"] is True
    assert result["data"]["state"] == "SUCCESS"
    assert result["data"]["result"]["summary"] == "a summary"
    assert result["data"]["result"]["databricksRunId"] == "999"


@pytest.mark.anyio
async def test_get_pdf_run_status_maps_pending_and_running() -> None:
    deps = make_deps()
    deps.workspace.jobs = FakeJobs(job_id=42, life_cycle_state="PENDING", result_state=None)
    tool = build_get_pdf_run_status(deps)
    pending = await tool(1)
    assert pending["data"]["state"] == "PENDING"

    deps.workspace.jobs = FakeJobs(job_id=42, life_cycle_state="RUNNING", result_state=None)
    tool = build_get_pdf_run_status(deps)
    running = await tool(2)
    assert running["data"]["state"] == "RUNNING"


@pytest.mark.anyio
async def test_get_pdf_run_status_maps_terminated_failure() -> None:
    deps = make_deps()
    deps.workspace.jobs = FakeJobs(job_id=42, life_cycle_state="TERMINATED", result_state="FAILED")
    tool = build_get_pdf_run_status(deps)

    result = await tool(3)

    assert result["data"]["state"] == "FAILED"
    assert "result" not in result["data"]
