"""The tool-calling agent loop that processes one PDF job end to end (PLAN.md §2.2/§2.7).

Runs a fixed pipeline (ingest -> extract -> enrich -> persist -> save_job_result) rather than a
free-form LLM tool loop for the AWS-facing steps, since those steps are deterministic; only
`enrich_document` calls the LLM. Every step appends a job event, and any failure is reported to
AWS as `FAILED` instead of raising (DEVELOPMENT.md G9).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any

from docintel_app.deps import Deps
from docintel_app.schemas import JobResult, err_result, ok_result
from docintel_app.tools import ToolFn
from docintel_app.tools.enrich import build_enrich_document
from docintel_app.tools.extract import build_extract_pdf_text
from docintel_app.tools.ingest import build_ingest_pdf
from docintel_app.tools.persist import build_persist_document_result

logger = logging.getLogger(__name__)

PROCESSOR = "databricks-pdf-agent"
SOURCE = "databricks"


@dataclass(frozen=True)
class _Tools:
    """The pipeline's tool functions, built once per run so tests can inject fakes via `deps`."""

    ingest: ToolFn
    extract: ToolFn
    enrich: ToolFn
    persist: ToolFn


async def run(deps: Deps, job: dict[str, Any]) -> dict[str, Any]:
    """Process one job. `job` needs `job_id`, `download_url`, `file_name`, and may include
    `source_s3_key`, `run_mode` ("sync"/"async", default "sync"), and `run_id` (the Databricks
    job run id).
    """
    job_id = job["job_id"]
    try:
        return await _run_pipeline(deps, job)
    except Exception as exc:
        logger.exception("pdf agent failed for job %s", job_id)
        await _report_status_best_effort(deps, job_id, "FAILED", message=str(exc))
        return err_result("agent_failed", str(exc))


async def _run_pipeline(deps: Deps, job: dict[str, Any]) -> dict[str, Any]:
    """Execute the fixed pipeline once; any step failure propagates to `run`'s except block."""
    job_id = job["job_id"]
    tools = _Tools(
        ingest=build_ingest_pdf(deps),
        extract=build_extract_pdf_text(deps),
        enrich=build_enrich_document(deps),
        persist=build_persist_document_result(deps),
    )
    await _report_status(deps, job_id, "PROCESSING")

    ingested = await _step(
        deps, job_id, "ingest", tools.ingest(job_id, job["download_url"], job["file_name"])
    )
    extracted = await _step(deps, job_id, "extract", tools.extract(ingested["data"]["volume_path"]))
    enriched = await _step(deps, job_id, "enrich", tools.enrich(extracted["data"]["text"]))
    document = _build_document(job, ingested["data"], extracted["data"], enriched["data"])
    persisted = await _step(deps, job_id, "persist", tools.persist(document))

    result = _build_result(document, persisted["data"], deps.settings.llm_endpoint)
    saved = await deps.aws.call(
        "save_job_result",
        {
            "job_id": job_id,
            "result_json": result.model_dump_json(by_alias=True),
            "processor": PROCESSOR,
            "source": SOURCE,
        },
    )
    _raise_if_aws_failed("save_job_result", saved)
    await _report_status(deps, job_id, "COMPLETED")
    return ok_result(result.model_dump(by_alias=True))


def _raise_if_aws_failed(tool: str, envelope: dict[str, Any]) -> None:
    """Raise if an AWS MCP tool's `{ok, data|error}` envelope reports failure.

    `AwsToolBackend`/`aws_mcp._unwrap` already raise for a transport-level MCP error
    (`is_error`); this catches the call succeeding at the protocol level but the tool itself
    reporting `{ok: false}` (e.g. a DynamoDB write failure) — without this, a failed
    `save_job_result`/`update_job_status` was silently ignored and the job still ended up
    reported/returned as COMPLETED.
    """
    if not envelope.get("ok"):
        error = envelope.get("error", {})
        raise RuntimeError(f"{tool} failed: {error.get('message', error)}")


async def _step(
    deps: Deps, job_id: str, name: str, coro: Awaitable[dict[str, Any]]
) -> dict[str, Any]:
    """Await one pipeline tool call, append a job event, and raise if it failed."""
    envelope = await coro
    if not envelope.get("ok"):
        error = envelope.get("error", {})
        raise RuntimeError(f"{name} failed: {error.get('message', error)}")
    await deps.aws.call(
        "append_job_event",
        {"job_id": job_id, "source": SOURCE, "tool": name, "message": f"{name} completed"},
    )
    return envelope


async def _report_status(deps: Deps, job_id: str, status: str, message: str | None = None) -> None:
    """Report job status to AWS (`update_job_status`), tagged with this processor's identity.

    Raises if AWS reports the update failed (see `_raise_if_aws_failed`); `run`'s failure path
    uses `_report_status_best_effort` instead so a broken status-reporting call doesn't mask the
    original error it's trying to report.
    """
    body: dict[str, Any] = {
        "job_id": job_id,
        "status": status,
        "source": SOURCE,
        "processor": PROCESSOR,
    }
    if message is not None:
        body["message"] = message
    envelope = await deps.aws.call("update_job_status", body)
    _raise_if_aws_failed("update_job_status", envelope)


async def _report_status_best_effort(
    deps: Deps, job_id: str, status: str, message: str | None = None
) -> None:
    """Report status to AWS, swallowing any failure: used from `run`'s except block, which is
    already mid-handling one failure and must still return `err_result` rather than raise a
    second one.
    """
    try:
        await _report_status(deps, job_id, status, message)
    except Exception:
        logger.exception("failed to report status=%s for job %s to AWS", status, job_id)


def _build_document(
    job: dict[str, Any],
    ingested: dict[str, Any],
    extracted: dict[str, Any],
    enriched: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the `persist_document_result` input from each step's output."""
    return {
        "job_id": job["job_id"],
        "file_name": job["file_name"],
        "source_s3_key": job.get("source_s3_key"),
        "volume_path": ingested["volume_path"],
        "extraction": extracted,
        "enrichment": enriched,
        "run_mode": job.get("run_mode", "sync"),
        "run_id": job.get("run_id"),
    }


def _build_result(document: dict[str, Any], persisted: dict[str, Any], model: str) -> JobResult:
    """Build the `save_job_result` payload (PLAN.md §2.4) from the assembled pipeline document."""
    extraction = document["extraction"]
    enrichment = document["enrichment"]
    # JobResult's fields use camelCase aliases (PLAN.md §2.4 wire shape); ty's synthesized
    # pydantic __init__ signature is keyed on the alias, so construct with alias kwargs.
    return JobResult(
        summary=enrichment["summary"],
        keyPoints=enrichment.get("key_points", []),
        entities=enrichment.get("entities", []),
        topics=enrichment.get("topics", []),
        sentiment=enrichment["sentiment"],
        language=enrichment["language"],
        pageCount=extraction["page_count"],
        wordCount=extraction["word_count"],
        extractionMethod=extraction["extraction_method"],
        model=model,
        ucTable=persisted["uc_table"],
        volumePath=document["volume_path"],
        databricks_run_id=document.get("run_id"),
    )
