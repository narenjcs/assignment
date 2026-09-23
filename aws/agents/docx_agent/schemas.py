"""Structured-output schema for the DOCX agent's enrichment step (PLAN.md §2.4 `result` shape).

The LLM is asked to emit JSON matching `DocumentInsights`; `enrich.py` validates the raw text
with `DocumentInsights.model_validate_json` and retries once on `pydantic.ValidationError`,
feeding the error back into the prompt (DEVELOPMENT.md §4 "structured output + validated retry").
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

_SENTIMENTS = ("positive", "neutral", "negative", "mixed")


class Entity(BaseModel):
    """A named entity mentioned in the document."""

    name: str = Field(min_length=1, description="Entity text as it appears in the document")
    type: str = Field(min_length=1, description="e.g. PERSON, ORG, DATE, MONEY, LOCATION")


class DocumentInsights(BaseModel):
    """LLM-authored analysis plus the deterministic facts it must copy through verbatim."""

    model_config = ConfigDict(populate_by_name=True)

    summary: str = Field(min_length=1, max_length=4000)
    key_points: list[str] = Field(alias="keyPoints", default_factory=list, max_length=20)
    entities: list[Entity] = Field(default_factory=list, max_length=50)
    topics: list[str] = Field(default_factory=list, max_length=15)
    sentiment: str
    language: str = Field(min_length=2, max_length=32)
    page_count: int = Field(alias="pageCount", ge=0)
    word_count: int = Field(alias="wordCount", ge=0)
    extraction_method: str = Field(alias="extractionMethod", min_length=1)
    model: str = Field(min_length=1)

    @field_validator("sentiment")
    @classmethod
    def _sentiment_known(cls, value: str) -> str:
        lowered = value.strip().lower()
        if lowered not in _SENTIMENTS:
            raise ValueError(f"sentiment must be one of {_SENTIMENTS}, got {value!r}")
        return lowered
