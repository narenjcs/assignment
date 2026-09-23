"""`docx_agent/schemas.py`: `DocumentInsights`/`Entity` validation (PLAN.md §2.4 `result` shape)."""

from __future__ import annotations

import pytest
from conftest import import_agent_module
from pydantic import ValidationError

schemas = import_agent_module("docx_agent", "schemas")


def _valid_payload() -> dict:
    return {
        "summary": "A short summary.",
        "keyPoints": ["point one"],
        "entities": [{"name": "Acme Corp", "type": "ORG"}],
        "topics": ["contracts"],
        "sentiment": "Positive",
        "language": "en",
        "pageCount": 2,
        "wordCount": 500,
        "extractionMethod": "mammoth",
        "model": "openai.gpt-oss-120b-1:0",
    }


def test_document_insights_accepts_camelcase_aliases() -> None:
    insights = schemas.DocumentInsights.model_validate(_valid_payload())
    assert insights.key_points == ["point one"]
    assert insights.page_count == 2
    assert insights.extraction_method == "mammoth"


def test_document_insights_round_trips_by_alias() -> None:
    insights = schemas.DocumentInsights.model_validate(_valid_payload())
    dumped = insights.model_dump(by_alias=True)
    assert dumped["keyPoints"] == ["point one"]
    assert dumped["pageCount"] == 2
    assert "key_points" not in dumped


def test_sentiment_is_normalised_to_lowercase() -> None:
    insights = schemas.DocumentInsights.model_validate(_valid_payload())
    assert insights.sentiment == "positive"


def test_sentiment_rejects_unknown_value() -> None:
    payload = _valid_payload() | {"sentiment": "ecstatic"}
    with pytest.raises(ValidationError, match="sentiment must be one of"):
        schemas.DocumentInsights.model_validate(payload)


def test_page_count_rejects_negative_values() -> None:
    payload = _valid_payload() | {"pageCount": -1}
    with pytest.raises(ValidationError):
        schemas.DocumentInsights.model_validate(payload)


def test_summary_requires_at_least_one_character() -> None:
    payload = _valid_payload() | {"summary": ""}
    with pytest.raises(ValidationError):
        schemas.DocumentInsights.model_validate(payload)


def test_entity_requires_name_and_type() -> None:
    with pytest.raises(ValidationError):
        schemas.Entity.model_validate({"name": "Acme"})
