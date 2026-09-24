"""`run_pdf_agent` and `get_pdf_run_status` MCP tools: entry points into the PDF agent pipeline.

Both tools' parameter and response shapes are a pinned cross-cloud contract (PLAN.md §2.7): the
AWS orchestrator calls them by these exact field names, so `run_pdf_agent` takes individual
scalar parameters rather than a bundled dict — even though that puts it over ruff's usual
4-parameter guideline (see its `noqa`) — to keep the tool's JSON Schema matching the contract.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any

from docintel_app import agent, uc
from docintel_app.aws_mcp import AwsToolBackend
from docintel_app.deps import Deps
from docintel_app.schemas import document_row_to_job_result, err_result, ok_result
from docintel_app.tools import ToolFn, guarded

AWS_TOKEN_SECRET_KEY = "aws_access_token"
"""Scope key the async job reads its AWS gateway token from (never a job parameter)."""

JOB_NAME = "docintel_pdf_agent"

# RunLifeCycleState values meaning the run hasn't started executing yet.
_PENDING_LIFE_CYCLE_STATES = {"PENDING", "QUEUED", "WAITING_FOR_RETRY", "BLOCKED"}
# ... meaning it's actively executing.
_RUNNING_LIFE_CYCLE_STATES = {"RUNNING", "TERMINATING"}
# RunResultState values that count as a clean success once the run has terminated.
_SUCCESS_RESULT_STATES = {"SUCCESS"}


def build_run_pdf_agent(deps: Deps) -> ToolFn:
    """Build the `run_pdf_agent` tool, closing over `deps`."""

    @guarded
    async def run_pdf_agent(  # noqa: PLR0913, PLR0917 — pinned contract, PLAN.md §2.7
        job_id: str,
        download_url: str,
        file_name: str,
        source_s3_key: str | None = None,
        mode: str = "sync",
        aws_token: str | None = None,
    ) -> dict[str, Any]:
        """Process a PDF job end to end (PLAN.md §2.7 pinned cross-cloud shape).

        `mode="sync"` (default) runs the pipeline inline and returns
        `{mode: "sync", result: JobResult}`. `mode="async"` triggers the `docintel_pdf_agent`
        Databricks job and returns `{mode: "async", run_id, state: "PENDING"}` immediately —
        poll `get_pdf_run_status` for completion.

        `aws_token`: an AWS Cognito access token minted by the caller. Serverless compute here
        resolves DNS through an allowlist that excludes the Cognito token endpoint, so this side
        cannot mint one itself; passing it in is what lets the agent call back into AWS.
        """
        job = {
            "job_id": job_id,
            "download_url": download_url,
            "file_name": file_name,
            "source_s3_key": source_s3_key,
        }
        if mode == "async":
            return await _trigger_async_run(deps, job, aws_token)
        run_deps = (
            replace(deps, aws=AwsToolBackend(deps.settings, token=aws_token)) if aws_token else deps
        )
        run_result = await agent.run(run_deps, {**job, "run_mode": "sync"})
        if not run_result.get("ok"):
            return run_result
        return ok_result({"mode": "sync", "result": run_result["data"]})

    return run_pdf_agent


def _find_job(deps: Deps) -> Any:
    """Look up the `docintel_pdf_agent` job by name (sync; called via `asyncio.to_thread`)."""
    return next(iter(deps.workspace.jobs.list(name=JOB_NAME)), None)


async def _trigger_async_run(
    deps: Deps, job: dict[str, str | None], aws_token: str | None = None
) -> dict[str, Any]:
    """Find the `docintel_pdf_agent` job by name and trigger it with `job` as its parameters.

    `aws_token` is deliberately NOT passed as a job parameter: Databricks stores job parameters
    in run history and shows them in the UI, so a one-hour bearer token for the AWS gateway
    would sit in a log. Write it to the secret scope instead — secrets are redacted in logs —
    and let the job read it back with `dbutils.secrets`.
    """
    # `jobs.list`/`jobs.run_now` are blocking Databricks SDK calls; run them on a worker thread
    # so triggering one job doesn't stall `/api/health` and other MCP calls.
    found = await asyncio.to_thread(_find_job, deps)
    if found is None or found.job_id is None:
        return err_result("job_not_found", f"no Databricks job named {JOB_NAME!r}")
    if aws_token:
        await asyncio.to_thread(
            deps.workspace.secrets.put_secret,
            scope=deps.settings.aws_secret_scope,
            key=AWS_TOKEN_SECRET_KEY,
            string_value=aws_token,
        )
    params = {k: v for k, v in job.items() if v is not None}
    waiter = await asyncio.to_thread(
        deps.workspace.jobs.run_now, job_id=found.job_id, job_parameters=params
    )
    return ok_result({"mode": "async", "run_id": waiter.run_id, "state": "PENDING"})


def build_get_pdf_run_status(deps: Deps) -> ToolFn:
    """Build the `get_pdf_run_status` tool, closing over `deps`."""

    @guarded
    async def get_pdf_run_status(run_id: int) -> dict[str, Any]:
        """Get the current state of an async `run_pdf_agent` job run (PLAN.md §2.7): Databricks
        `life_cycle_state`/`result_state` are mapped onto PENDING|RUNNING|SUCCESS|FAILED, and
        `result` (the persisted `JobResult`) is attached once the run has SUCCEEDED.
        """
        # `jobs.get_run` is a blocking Databricks SDK call; run it on a worker thread so polling
        # one run's status doesn't stall `/api/health` and other MCP calls.
        run = await asyncio.to_thread(deps.workspace.jobs.get_run, run_id)
        state = _map_state(run.state)
        data: dict[str, Any] = {"run_id": run_id, "state": state}
        if run.state and run.state.state_message:
            data["message"] = run.state.state_message
        if state == "SUCCESS":
            result = await _fetch_result(deps, run)
            if result is not None:
                data["result"] = result.model_dump(by_alias=True)
        return ok_result(data)

    return get_pdf_run_status


async def _fetch_result(deps: Deps, run: Any) -> Any:
    """Look up the `job_id` this run was triggered with and read back its persisted row."""
    params = {p.name: p.value for p in (run.job_parameters or []) if p.name}
    job_id = params.get("job_id")
    if not job_id:
        return None
    row = await asyncio.to_thread(
        uc.fetch_row, deps.workspace, deps.settings.warehouse_id, deps.settings.uc_table, job_id
    )
    return document_row_to_job_result(row, deps.settings.uc_table) if row else None


def _map_state(state: Any) -> str:
    """Map a Databricks `RunState` onto PENDING|RUNNING|SUCCESS|FAILED (PLAN.md §2.7)."""
    if state is None:
        return "PENDING"
    life_cycle = _enum_value(state.life_cycle_state)
    if life_cycle in _PENDING_LIFE_CYCLE_STATES:
        return "PENDING"
    if life_cycle in _RUNNING_LIFE_CYCLE_STATES:
        return "RUNNING"
    return "SUCCESS" if _enum_value(state.result_state) in _SUCCESS_RESULT_STATES else "FAILED"


def _enum_value(value: Any) -> str | None:
    """Return an SDK enum's `.value`, or the value itself if it is already a plain string."""
    return getattr(value, "value", value)
