"""`docx_agent/prompts.py`: prompt constants exist and format with the placeholders `enrich.py`
actually supplies (DEVELOPMENT.md G3: no inline multi-line prompts, so these live here alone)."""

from __future__ import annotations

from conftest import import_agent_module

prompts = import_agent_module("docx_agent", "prompts")


def test_system_prompt_is_a_non_empty_string() -> None:
    assert isinstance(prompts.SYSTEM_PROMPT, str)
    assert len(prompts.SYSTEM_PROMPT.strip()) > 0


def test_enrichment_prompt_template_formats_with_expected_fields() -> None:
    rendered = prompts.ENRICHMENT_PROMPT_TEMPLATE.format(
        page_count=2,
        word_count=500,
        extraction_method="mammoth",
        model="openai.gpt-oss-120b-1:0",
        text="Hello world.",
    )
    assert "pageCount=2" in rendered
    assert "Hello world." in rendered


def test_retry_suffix_template_formats_with_error() -> None:
    rendered = prompts.RETRY_SUFFIX_TEMPLATE.format(error="field required")
    assert "field required" in rendered
