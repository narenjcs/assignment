"""DOCX job pipeline: extract -> LLM-enrich (validated, retried once) -> save (DEVELOPMENT.md §9
"Result objects", "Idempotent steps"). `run_docx_job` is what `main.py`'s entrypoint calls;
`LlmCall` is injected so tests exercise the validation-retry path with a fake, network-free LLM.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable

from docintel_common.events import error_event, result_event
from docintel_common.mcp_backend import ToolBackend, require_ok
from docintel_common.text import truncate_message
from prompts import ENRICHMENT_PROMPT_TEMPLATE, RETRY_SUFFIX_TEMPLATE
from pydantic import ValidationError
from schemas import DocumentInsights

AGENT_NAME = "docx-agent"
LlmCall = Callable[[str], Awaitable[str]]

logger = logging.getLogger(__name__)


class EnrichmentError(RuntimeError):
    """Raised when the LLM's structured output still fails validation after one retry."""


async def run_docx_job(backend: ToolBackend, llm_call: LlmCall, job_id: str, model_id: str) -> dict:
    """Extract, enrich and persist one DOCX job; returns a terminal `result` or `error` event.

    Any failure - including one raised by `_mark_processing` itself - marks the job FAILED via
    `update_job_status` before returning the `error` event; the caller (`main.py`) is responsible
    for translating that into the AgentCore response shape.
    """
    try:
        _mark_processing(backend, job_id)
        raw_extract = backend.call("extract_docx_text", {"job_id": job_id})
        extracted = require_ok(raw_extract, "extract_docx_text")
        insights = await _enrich_with_retry(llm_call, extracted, model_id)
        result = insights.model_dump(by_alias=True)
        _save_result(backend, job_id, result)
        return result_event(job_id, result)
    except Exception as exc:
        message = str(exc)
        logger.error("docx job failed", extra={"job_id": job_id, "error": message})
        _mark_failed(backend, job_id, message)
        return error_event(job_id, message)


def _mark_processing(backend: ToolBackend, job_id: str) -> None:
    require_ok(
        backend.call(
            "update_job_status",
            {
                "job_id": job_id,
                "status": "PROCESSING",
                "source": "aws",
                "agent": AGENT_NAME,
                "message": "Extracting text",
            },
        ),
        "update_job_status",
    )


def _mark_failed(backend: ToolBackend, job_id: str, message: str) -> None:
    """Best-effort FAILED status write: never raises, so a broken status call can't mask the
    original error already logged above."""
    try:
        require_ok(
            backend.call(
                "update_job_status",
                {
                    "job_id": job_id,
                    "status": "FAILED",
                    "source": "aws",
                    "agent": AGENT_NAME,
                    "message": truncate_message(message),
                },
            ),
            "update_job_status",
        )
    except Exception:
        logger.error("failed to mark job FAILED", extra={"job_id": job_id})


def _save_result(backend: ToolBackend, job_id: str, result: dict) -> None:
    require_ok(
        backend.call(
            "save_job_result",
            {
                "job_id": job_id,
                "result_json": json.dumps(result),
                "processor": "aws-docx-agent",
                "source": "aws",
                "agent": AGENT_NAME,
            },
        ),
        "save_job_result",
    )


async def _enrich_with_retry(llm_call: LlmCall, extracted: dict, model_id: str) -> DocumentInsights:
    prompt = ENRICHMENT_PROMPT_TEMPLATE.format(
        page_count=extracted.get("pageCount", 0),
        word_count=extracted.get("wordCount", 0),
        extraction_method=extracted.get("extractionMethod", "unknown"),
        model=model_id,
        text=extracted.get("text", ""),
    )
    raw = await llm_call(prompt)
    try:
        return DocumentInsights.model_validate_json(raw)
    except ValidationError as first_error:
        retry_prompt = prompt + RETRY_SUFFIX_TEMPLATE.format(error=str(first_error))
        raw_retry = await llm_call(retry_prompt)
        try:
            return DocumentInsights.model_validate_json(raw_retry)
        except ValidationError as second_error:
            message = f"LLM output failed validation twice: {second_error}"
            raise EnrichmentError(message) from second_error
