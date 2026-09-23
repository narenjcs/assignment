"""Unit tests for the pure helpers in `scripts/mcp-smoke.py` — no network, no AWS/Databricks
calls (those are exercised by actually running `scripts/mcp-smoke.py` against a deployed stack;
see `docs/DEMO.md`). The module is loaded via `importlib` because its filename has a hyphen and
so cannot be `import`-ed normally.
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
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


# -- Cross-cloud secret key-casing regression guards ----------------------------------------
#
# Two distinct namespaces exist and must not be confused (see docs/PLAN.md §5):
#   * AWS Secrets Manager JSON payloads (`docintel/aws-mcp`, `docintel/databricks`) = camelCase,
#     because that's what `aws/common/docintel_common/mcp_backend.py` and the CDK
#     (`aws/infra/lib/constructs/auth.ts`) both read/write.
#   * Databricks secret-scope keys (written by scripts/link.sh direction 1) = snake_case,
#     because that's what `databricks/resources/apps.yml` declares.
# These tests pin the exact key set on both sides so a future edit can't silently swap casing.


def test_parse_aws_mcp_secret_reads_camel_case_client_secret() -> None:
    raw = json.dumps(
        {
            "tokenUrl": "https://cognito.example/oauth2/token",
            "clientId": "abc",
            "clientSecret": "shh",
            "scope": "docintel/invoke",
            "gatewayUrl": "https://gw.example",
        }
    )
    assert mcp_smoke.parse_aws_mcp_secret(raw) == "shh"


def test_parse_aws_mcp_secret_rejects_snake_case_key() -> None:
    raw = json.dumps({"token_url": "x", "client_id": "abc", "client_secret": "shh"})
    with pytest.raises(KeyError):
        mcp_smoke.parse_aws_mcp_secret(raw)


def test_parse_aws_mcp_secret_falls_back_to_raw_for_plain_text() -> None:
    assert mcp_smoke.parse_aws_mcp_secret("plain-secret-value") == "plain-secret-value"


def test_parse_databricks_secret_reads_camel_case_fields() -> None:
    raw = json.dumps(
        {
            "host": "https://dbc-example.cloud.databricks.com",
            "clientId": "sp-id",
            "clientSecret": "sp-secret",
            "mcpUrl": "https://mcp-docintel.example/mcp",
            "jobId": "12345",
        }
    )
    assert mcp_smoke.parse_databricks_secret(raw) == (
        "https://dbc-example.cloud.databricks.com",
        "sp-id",
        "sp-secret",
        "https://mcp-docintel.example/mcp",
    )


def test_parse_databricks_secret_rejects_snake_case_keys() -> None:
    raw = json.dumps({"host": "h", "client_id": "i", "client_secret": "s", "mcp_url": "u"})
    with pytest.raises(KeyError):
        mcp_smoke.parse_databricks_secret(raw)


_LINK_SH = (Path(__file__).resolve().parent.parent / "link.sh").read_text()


def _run_jq(filter_expr: str, args: dict[str, str]) -> dict[str, object]:
    jq_args = []
    for name, value in args.items():
        jq_args += ["--arg", name, value]
    proc = subprocess.run(
        ["jq", "-n", *jq_args, filter_expr],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    return dict(json.loads(proc.stdout))


@pytest.mark.skipif(shutil.which("jq") is None, reason="jq not on PATH")
def test_link_sh_builds_databricks_secret_json_with_exact_camel_case_keys() -> None:
    # Extract the literal jq object-construction filter link.sh feeds to
    # `aws secretsmanager put-secret-value` for the docintel/databricks secret, so this test
    # fails the moment that filter's key names drift instead of only catching it live.
    match = re.search(r"'(\{host:[^']*\})'", _LINK_SH)
    assert match, "could not find the jq filter that builds the AWS secret JSON in link.sh"
    payload = _run_jq(
        match.group(1),
        {
            "host": "https://dbc-example.cloud.databricks.com",
            "id": "sp-id",
            "secret": "sp-secret",
            "mcp_url": "https://mcp-docintel.example/mcp",
            "job_id": "12345",
        },
    )
    assert set(payload) == {"host", "clientId", "clientSecret", "mcpUrl", "jobId"}


def test_link_sh_writes_snake_case_databricks_secret_scope_keys() -> None:
    # The other direction (AWS -> Databricks secret scope) is a different namespace and must
    # stay snake_case, matching the keys `databricks/resources/apps.yml` declares.
    keys = set(re.findall(r"put_db_secret (\w+) ", _LINK_SH))
    assert keys == {
        "aws_gateway_url",
        "aws_mcp_token_url",
        "aws_mcp_client_id",
        "aws_mcp_client_secret",
        "aws_mcp_scope",
    }
