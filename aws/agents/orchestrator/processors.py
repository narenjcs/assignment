"""Strategy processors: route a job to its docType-specific pipeline (PLAN.md §2.2,
DEVELOPMENT.md §9 "Strategy pattern" - the code enforces which path runs, not the LLM).

`AwsDocxProcessor` and `DatabricksPdfProcessor` are injected into `workflow.py` (DI by
parameter, DEVELOPMENT.md §9), so tests exercise both routing paths with fake `ToolBackend`s
and a fake `delegate` callable - no network, no real MCP client.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from docintel_common.mcp_backend import DEFAULT_READ_TIMEOUT_S, ToolBackend, require_ok

DelegateFn = Callable[[str, str], dict]
_SYNC_RUN_TIMEOUT_S = 600.0
"""`run_pdf_agent(mode="sync")` runs the whole PDF pipeline inline inside the Databricks App
call, which can comfortably exceed the default 120s MCP read timeout."""


class Processor(Protocol):
    """Runs one job to completion and returns its `result` dict (PLAN §2.4 shape)."""

    def run(self, job: dict, mode: str) -> dict:
        """Process `job` in `mode` ("sync" | "async") and return the structured result."""
        ...


class ProcessorError(RuntimeError):
    """Raised when a processor's downstream call reports failure."""


@dataclass(frozen=True)
class PollConfig:
    """Backoff schedule for polling an async Databricks run."""

    max_attempts: int = 10
    initial_interval_s: float = 3.0
    max_interval_s: float = 30.0


@dataclass
class AwsDocxProcessor:
    """Runs a `docType=docx` job by delegating to the DOCX AgentCore runtime."""

    delegate: DelegateFn

    def run(self, job: dict, mode: str) -> dict:
        response = self.delegate(job["jobId"], mode)
        if not response.get("ok", False):
            error = response.get("error") or {}
            message = (
                error.get("message", "unknown error") if isinstance(error, dict) else str(error)
            )
            raise ProcessorError(f"docx agent failed: {message}")
        return response.get("result", {})


@dataclass
class DatabricksPdfProcessor:
    """Runs a `docType=pdf` job via the Databricks MCP server (PLAN §2.2 sync/async flows)."""

    aws_backend: ToolBackend
    databricks_backend: Callable[[], ToolBackend]
    """Opens the Databricks MCP session on first use (see `tools.workflow_session`).

    A callable rather than an open backend so a DOCX job never connects to Databricks - the AWS
    half stays deployable and demonstrable before the workspace exists.
    """
    aws_token_provider: Callable[[], str] | None = None
    """Returns a Cognito access token to hand to the Databricks agent (see `run`)."""
    poll: PollConfig = field(default_factory=PollConfig)
    _dbx: ToolBackend | None = field(default=None, init=False, repr=False)

    def _databricks(self) -> ToolBackend:
        """Return the Databricks backend, opening the session on first use and reusing it after."""
        if self._dbx is None:
            self._dbx = self.databricks_backend()
        return self._dbx

    def run(self, job: dict, mode: str) -> dict:
        """PLAN.md §2.7: `run_pdf_agent` returns `data={mode:'sync', result}` (sync) or
        `data={mode:'async', run_id:int, state:'PENDING'}` (async); the async branch then polls
        `get_pdf_run_status` by `run_id` (an int, not `databricks_run_id`) until `SUCCESS`/
        `FAILED` and reads the ready `JobResult` straight off `data.result` there.
        """
        job_id = job["jobId"]
        download = require_ok(
            self.aws_backend.call("get_download_url", {"job_id": job_id}), "get_download_url"
        )
        run_args: dict[str, object] = {
            "job_id": job_id,
            "download_url": download.get("downloadUrl", ""),
            "file_name": job.get("fileName", ""),
            "mode": mode,
        }
        if job.get("s3Key"):
            run_args["source_s3_key"] = job["s3Key"]
        # Databricks serverless resolves DNS through an allowlist that excludes the Cognito token
        # endpoint, so the PDF agent cannot mint a token to call back into AWS. Hand it ours.
        if self.aws_token_provider is not None:
            run_args["aws_token"] = self.aws_token_provider()
        timeout = _SYNC_RUN_TIMEOUT_S if mode == "sync" else DEFAULT_READ_TIMEOUT_S
        started = require_ok(
            self._databricks().call("run_pdf_agent", run_args, read_timeout_seconds=timeout),
            "run_pdf_agent",
        )
        if mode == "sync":
            return _as_dict(started.get("result"))
        return self._await_async_result(job_id, started.get("run_id"))

    def _await_async_result(self, job_id: str, run_id: object) -> dict:
        """Poll `get_pdf_run_status` until `SUCCESS`/`FAILED`.

        `SUCCESS`'s `data.result` is already a ready camelCase `JobResult` (the Databricks side
        built it via `document_row_to_job_result`) - `get_document_result` is never used to
        build the result itself, only as an optional enrichment below.
        """
        interval = self.poll.initial_interval_s
        for _ in range(self.poll.max_attempts):
            status = require_ok(
                self._databricks().call("get_pdf_run_status", {"run_id": run_id}),
                "get_pdf_run_status",
            )
            state = status.get("state")
            if state == "FAILED":
                message = status.get("message", "PDF run failed")
                raise ProcessorError(f"databricks run {run_id} failed: {message}")
            if state == "SUCCESS":
                result = _as_dict(status.get("result"))
                if not result:
                    raise ProcessorError(f"databricks run {run_id} succeeded without a result")
                return self._enrich_volume_path(job_id, result)
            time.sleep(interval)
            interval = min(interval * 2, self.poll.max_interval_s)
        raise ProcessorError(
            f"databricks run {run_id} did not finish within {self.poll.max_attempts} polls"
        )

    def _enrich_volume_path(self, job_id: str, result: dict) -> dict:
        """Fill in `volumePath` from `get_document_result`'s UC row only if `result` lacks it.

        `get_document_result`'s row is `DocumentRow` (PLAN.md §2.5, snake_case, no `ucTable`
        field) - it is never used wholesale as the AWS `save_job_result` payload, only to read
        back `volume_path` for this one optional fill-in.
        """
        if result.get("volumePath"):
            return result
        document = require_ok(
            self._databricks().call("get_document_result", {"job_id": job_id}),
            "get_document_result",
        )
        if not document.get("found", False):
            return result
        volume_path = _as_dict(document.get("row")).get("volume_path")
        return {**result, "volumePath": volume_path} if volume_path else result


def _as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}
