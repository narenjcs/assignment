"""Pydantic schemas shared across the app: extraction/enrichment output, the Unity Catalog
`document_results` row (PLAN.md §2.5), the AWS job-result payload (PLAN.md §2.4), and the
`{ok, data|error}` tool envelope every MCP tool returns (DEVELOPMENT.md §9/§11).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Entity(BaseModel):
    """A single named entity extracted from the document."""

    name: str
    type: str


class Enrichment(BaseModel):
    """Structured LLM output produced by `llm.enrich()`."""

    summary: str
    key_points: list[str] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    sentiment: str
    language: str


class ExtractionResult(BaseModel):
    """Output of `tools.extract`: raw text plus how it was obtained."""

    text: str
    page_count: int
    word_count: int
    extraction_method: Literal["pypdf", "ai_parse_document"]


class DocumentRow(BaseModel):
    """One row of `${catalog}.${schema}.document_results` (PLAN.md §2.5)."""

    job_id: str
    file_name: str | None = None
    source_s3_key: str | None = None
    volume_path: str | None = None
    page_count: int | None = None
    word_count: int | None = None
    char_count: int | None = None
    extraction_method: str | None = None
    extracted_text: str | None = None
    summary: str | None = None
    key_points: list[str] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    sentiment: str | None = None
    language: str | None = None
    model: str | None = None
    run_mode: Literal["sync", "async"] = "sync"
    run_id: str | None = None
    processed_at: datetime | None = None


class JobResult(BaseModel):
    """Payload sent to AWS `save_job_result` as `result_json` (PLAN.md §2.4 `result` shape)."""

    model_config = ConfigDict(populate_by_name=True)

    summary: str
    key_points: list[str] = Field(default_factory=list, alias="keyPoints")
    entities: list[Entity] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    sentiment: str
    language: str
    page_count: int = Field(alias="pageCount")
    word_count: int = Field(alias="wordCount")
    extraction_method: str = Field(alias="extractionMethod")
    model: str
    uc_table: str = Field(alias="ucTable")
    volume_path: str = Field(alias="volumePath")
    databricks_run_id: str | None = Field(default=None, alias="databricksRunId")


def document_row_to_job_result(row: DocumentRow, uc_table: str) -> JobResult | None:
    """Rebuild a `JobResult` from a persisted `DocumentRow` (used by `get_pdf_run_status` to
    return `result` once an async run has completed). Returns `None` if the row is missing a
    field `JobResult` requires (e.g. the run failed before `enrich_document`/`persist` ran).
    """
    # Bound to locals (rather than checked as `row.field is None` inline) so ty can narrow them
    # from `str | None` to `str` at the `JobResult(...)` call below.
    summary, sentiment, language = row.summary, row.sentiment, row.language
    page_count, word_count = row.page_count, row.word_count
    extraction_method = row.extraction_method
    if (
        summary is None
        or sentiment is None
        or language is None
        or page_count is None
        or word_count is None
        or extraction_method is None
    ):
        return None
    return JobResult(
        summary=summary,
        keyPoints=row.key_points,
        entities=row.entities,
        topics=row.topics,
        sentiment=sentiment,
        language=language,
        pageCount=page_count,
        wordCount=word_count,
        extractionMethod=extraction_method,
        model=row.model or "",
        ucTable=uc_table,
        volumePath=row.volume_path or "",
        databricks_run_id=row.run_id,
    )


class ToolError(BaseModel):
    """Error half of the `{ok, data|error}` tool envelope."""

    code: str
    message: str


class ToolEnvelope(BaseModel):
    """Uniform tool result: `{ok: true, data}` on success, `{ok: false, error}` on failure."""

    ok: bool
    data: dict[str, Any] | None = None
    error: ToolError | None = None


def ok_result(data: dict[str, Any]) -> dict[str, Any]:
    """Build a successful tool envelope dict. Every MCP tool function returns this shape."""
    return ToolEnvelope(ok=True, data=data).model_dump(exclude_none=True)


def err_result(code: str, message: str) -> dict[str, Any]:
    """Build a failed tool envelope dict. MCP tools never raise; they call this instead."""
    return ToolEnvelope(ok=False, error=ToolError(code=code, message=message)).model_dump(
        exclude_none=True
    )
