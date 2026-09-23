"""`orchestrator/prompts.py`: prompt constants exist and format with the placeholders
`workflow.py` actually supplies."""

from __future__ import annotations

from conftest import import_agent_module

prompts = import_agent_module("orchestrator", "prompts")


def test_system_prompt_is_a_non_empty_string() -> None:
    assert isinstance(prompts.SYSTEM_PROMPT, str)
    assert len(prompts.SYSTEM_PROMPT.strip()) > 0


def test_synthesis_prompt_template_formats_with_expected_fields() -> None:
    rendered = prompts.SYNTHESIS_PROMPT_TEMPLATE.format(
        job_id="job-1", file_name="report.docx", result_json="{}"
    )
    assert "job-1" in rendered
    assert "report.docx" in rendered


def test_chat_prompt_template_formats_with_expected_fields() -> None:
    rendered = prompts.CHAT_PROMPT_TEMPLATE.format(
        job_id="job-1", result_json="{}", message="What is the summary?"
    )
    assert "What is the summary?" in rendered
