"""Unit tests for the pure helpers in `scripts/mcp-smoke.py` — no network, no AWS/Databricks
calls (those are exercised by actually running `scripts/mcp-smoke.py` against a deployed stack;
see `docs/DEMO.md`). The module is loaded via `importlib` because its filename has a hyphen and
so cannot be `import`-ed normally.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from mcp.types import CallToolResult, TextContent

_MODULE_PATH = Path(__file__).resolve().parent.parent / "mcp-smoke.py"
_spec = importlib.util.spec_from_file_location("mcp_smoke", _MODULE_PATH)
assert _spec is not None
assert _spec.loader is not None
mcp_smoke = importlib.util.module_from_spec(_spec)
sys.modules["mcp_smoke"] = mcp_smoke
_spec.loader.exec_module(mcp_smoke)


def test_expected_aws_tools_matches_tools_json() -> None:
    tools = mcp_smoke.expected_aws_tools()
    assert len(tools) == 7
    assert set(tools) == {
        "get_job",
        "list_jobs",
        "update_job_status",
        "append_job_event",
        "save_job_result",
        "extract_docx_text",
        "get_download_url",
    }


def test_databricks_tool_names_constant_has_eight_tools() -> None:
    assert len(mcp_smoke.DATABRICKS_TOOL_NAMES) == 8
    assert "health" in mcp_smoke.DATABRICKS_TOOL_NAMES
    assert "run_pdf_agent" in mcp_smoke.DATABRICKS_TOOL_NAMES


def test_normalize_tool_name_strips_default_prefix() -> None:
    assert mcp_smoke.normalize_tool_name("jobs___get_job") == "get_job"


def test_normalize_tool_name_leaves_unprefixed_name_alone() -> None:
    assert mcp_smoke.normalize_tool_name("get_job") == "get_job"


def test_normalize_tool_name_custom_prefix() -> None:
    assert mcp_smoke.normalize_tool_name("target___health", prefix="target___") == "health"


def test_parse_dotenv_basic_key_value() -> None:
    text = "GatewayUrl=https://example.com\nAWS_REGION=us-east-1\n"
    assert mcp_smoke.parse_dotenv(text) == {
        "GatewayUrl": "https://example.com",
        "AWS_REGION": "us-east-1",
    }


def test_parse_dotenv_ignores_blank_lines_and_comments() -> None:
    text = "# a comment\n\nKEY=value\n   \n# another\n"
    assert mcp_smoke.parse_dotenv(text) == {"KEY": "value"}


def test_parse_dotenv_strips_surrounding_quotes() -> None:
    text = "A=\"quoted\"\nB='single'\nC=bare\n"
    assert mcp_smoke.parse_dotenv(text) == {"A": "quoted", "B": "single", "C": "bare"}


def test_parse_dotenv_ignores_lines_without_equals() -> None:
    assert mcp_smoke.parse_dotenv("not-a-kv-line\nKEY=value\n") == {"KEY": "value"}


def test_parse_cdk_outputs_picks_matching_stack_name() -> None:
    text = '{"DocIntelStack": {"GatewayUrl": "https://a"}, "Other": {"X": "y"}}'
    assert mcp_smoke.parse_cdk_outputs(text) == {"GatewayUrl": "https://a"}


def test_parse_cdk_outputs_falls_back_when_name_absent() -> None:
    text = '{"SomeOtherStack": {"GatewayUrl": "https://b"}}'
    assert mcp_smoke.parse_cdk_outputs(text, stack_name="DocIntelStack") == {
        "GatewayUrl": "https://b"
    }


def test_require_returns_present_value() -> None:
    assert mcp_smoke.require({"K": "v"}, "K") == "v"


def test_require_raises_on_missing_key() -> None:
    try:
        mcp_smoke.require({}, "Missing")
    except RuntimeError as exc:
        assert "Missing" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")


def test_summarize_all_ok() -> None:
    results = [mcp_smoke.CheckResult("a", True, "fine"), mcp_smoke.CheckResult("b", True, "")]
    summary = mcp_smoke.summarize(results)
    assert summary["ok"] is True
    assert len(summary["checks"]) == 2


def test_summarize_one_failure_flips_overall_ok() -> None:
    results = [mcp_smoke.CheckResult("a", True, ""), mcp_smoke.CheckResult("b", False, "boom")]
    summary = mcp_smoke.summarize(results)
    assert summary["ok"] is False
    assert summary["checks"][1] == {"name": "b", "ok": False, "detail": "boom"}


def test_unwrap_call_result_prefers_structured_content() -> None:
    result = CallToolResult(content=[], structured_content={"ok": True, "data": {"n": 1}})
    assert mcp_smoke.unwrap_call_result(result) == {"ok": True, "data": {"n": 1}}


def test_unwrap_call_result_parses_text_content_json() -> None:
    text = TextContent(type="text", text='{"ok": true, "data": {}}')
    result = CallToolResult(content=[text])
    assert mcp_smoke.unwrap_call_result(result) == {"ok": True, "data": {}}


def test_unwrap_call_result_is_error_short_circuits() -> None:
    text = TextContent(type="text", text="irrelevant")
    result = CallToolResult(content=[text], is_error=True)
    envelope = mcp_smoke.unwrap_call_result(result)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "MCP_ERROR"


def test_unwrap_call_result_handles_non_json_text() -> None:
    text = TextContent(type="text", text="not json")
    result = CallToolResult(content=[text])
    envelope = mcp_smoke.unwrap_call_result(result)
    assert envelope["ok"] is False
    assert envelope["error"]["code"] == "PARSE_ERROR"
