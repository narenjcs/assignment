#!/usr/bin/env python3
"""Smoke-tests the AWS Gateway and Databricks App MCP servers (PLAN.md §5 step 3, T3.3/T6.2).

Usage: python scripts/mcp-smoke.py aws|databricks|both [--json]. Config precedence: real env
vars > `.env` (repo root) > `cdk-outputs.json` (repo root); see `require()` calls below for the
per-mode keys each target needs. Both also need AWS creds (boto3 default chain).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any, NamedTuple

import boto3
import httpx
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_SECONDS = 20.0
GATEWAY_TARGET_PREFIX = "jobs___"
AWS_TOOL_NAMES = tuple(
    "get_job list_jobs update_job_status append_job_event "  # noqa: SIM905
    "save_job_result extract_docx_text get_download_url".split()
)
DATABRICKS_TOOL_NAMES = tuple(
    "ingest_pdf extract_pdf_text enrich_document persist_document_result "  # noqa: SIM905
    "get_document_result run_pdf_agent get_pdf_run_status health".split()
)


class CheckResult(NamedTuple):
    name: str
    ok: bool
    detail: str = ""


def expected_aws_tools() -> tuple[str, ...]:
    return AWS_TOOL_NAMES


def normalize_tool_name(name: str, prefix: str = GATEWAY_TARGET_PREFIX) -> str:
    return name[len(prefix) :] if name.startswith(prefix) else name


def parse_dotenv(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("\"'")
    return values


def parse_cdk_outputs(text: str, stack_name: str = "DocIntelStack") -> dict[str, str]:
    data = json.loads(text)
    return dict(data[stack_name] if stack_name in data else next(iter(data.values())))


def unwrap_call_result(result: CallToolResult) -> dict[str, Any]:
    if getattr(result, "is_error", False):
        return {"ok": False, "error": {"code": "MCP_ERROR", "message": str(result)[:200]}}
    if result.structured_content is not None:
        return dict(result.structured_content)
    text = getattr(result.content[0], "text", "{}") if result.content else "{}"
    try:
        return dict(json.loads(text))
    except json.JSONDecodeError:
        return {"ok": False, "error": {"code": "PARSE_ERROR", "message": text[:200]}}


def summarize(results: list[CheckResult]) -> dict[str, Any]:
    return {
        "ok": all(r.ok for r in results),
        "checks": [{"name": r.name, "ok": r.ok, "detail": r.detail} for r in results],
    }


def load_config() -> dict[str, str]:
    cfg: dict[str, str] = {}
    outputs_path = ROOT / "cdk-outputs.json"
    if outputs_path.exists():
        cfg.update(parse_cdk_outputs(outputs_path.read_text()))
    env_path = ROOT / ".env"
    if env_path.exists():
        cfg.update(parse_dotenv(env_path.read_text()))
    for key in [*cfg, "AWS_REGION"]:
        if key in os.environ:
            cfg[key] = os.environ[key]
    return cfg


def require(cfg: dict[str, str], key: str) -> str:
    value = cfg.get(key, "")
    if not value:
        raise RuntimeError(f"missing config value {key!r} (check cdk-outputs.json / .env)")
    return value


def read_secret(arn: str, region: str) -> str:
    client = boto3.client("secretsmanager", region_name=region)
    return str(client.get_secret_value(SecretId=arn)["SecretString"])


def m2m_token(token_url: str, client_id: str, client_secret: str, scope: str) -> str:
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = httpx.post(
        token_url,
        data={"grant_type": "client_credentials", "scope": scope},
        headers={"Authorization": f"Basic {basic}"},
        timeout=TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    return str(resp.json()["access_token"])


async def _probe_mcp(  # noqa: PLR0913, PLR0917 -- one call per probe keeps callers simple
    url: str, token: str, expected: tuple[str, ...], call_tool: str, call_args: dict[str, Any]
) -> list[CheckResult]:
    results: list[CheckResult] = []
    http_client = httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"})
    transport = streamable_http_client(url, http_client=http_client)
    async with Client(transport, read_timeout_seconds=TIMEOUT_SECONDS) as client:
        names = [t.name for t in (await client.list_tools()).tools]
        by_bare = {normalize_tool_name(n): n for n in names}
        missing = [t for t in expected if t not in by_bare]
        detail = f"missing {missing}" if missing else f"{len(names)} tools: {sorted(names)}"
        results.append(CheckResult("list_tools", not missing, detail))
        target = by_bare.get(call_tool)
        if target is None:
            results.append(CheckResult(f"call_{call_tool}", False, f"{call_tool} not listed"))
            return results
        envelope = unwrap_call_result(await client.call_tool(target, call_args))
        detail = json.dumps(envelope)[:200]
        results.append(CheckResult(f"call_{call_tool}", bool(envelope.get("ok")), detail))
    return results


async def run_cloud_checks(cfg: dict[str, str], cloud: str) -> list[CheckResult]:
    region = cfg.get("AWS_REGION", "us-east-1")
    try:
        if cloud == "aws":
            raw_secret = read_secret(require(cfg, "AwsMcpSecretArn"), region)
            try:
                parsed = json.loads(raw_secret)
                secret = str(parsed["clientSecret"]) if isinstance(parsed, dict) else raw_secret
            except json.JSONDecodeError:
                secret = raw_secret
            keys = ("CognitoTokenUrl", "CognitoClientId", "CognitoScope", "GatewayUrl")
            token_url, client_id, scope, url = (require(cfg, k) for k in keys)
            token = m2m_token(token_url, client_id, secret, scope)
            expected, tool, args, label = AWS_TOOL_NAMES, "list_jobs", {"limit": 1}, "cognito_token"
        else:
            secret_json = json.loads(read_secret(require(cfg, "DatabricksSecretArn"), region))
            token_url = f"{secret_json['host'].rstrip('/')}/oidc/v1/token"
            client_id, client_secret = secret_json["client_id"], secret_json["client_secret"]
            token = m2m_token(token_url, client_id, client_secret, "all-apis")
            url, label = secret_json["mcp_url"], "databricks_oauth_token"
            expected, tool, args = DATABRICKS_TOOL_NAMES, "health", {}
    except Exception as exc:
        return [CheckResult(f"{cloud}_token", False, str(exc))]
    checks = [CheckResult(label, True, "obtained")]
    try:
        checks += await _probe_mcp(url, token, expected, tool, args)
    except Exception as exc:
        checks.append(CheckResult("mcp_session", False, str(exc)))
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the AWS/Databricks MCP servers.")
    parser.add_argument("target", choices=["aws", "databricks", "both"])
    parser.add_argument("--json", action="store_true", help="also print a machine-readable summary")
    args = parser.parse_args()
    cfg = load_config()
    results: list[CheckResult] = []
    if args.target in ("aws", "both"):
        results += asyncio.run(run_cloud_checks(cfg, "aws"))
    if args.target in ("databricks", "both"):
        results += asyncio.run(run_cloud_checks(cfg, "databricks"))
    for result in results:
        mark = "OK " if result.ok else "FAIL"
        print(f"  [{mark}] {result.name}: {result.detail}")
    if args.json:
        print(json.dumps(summarize(results)))
    return 0 if results and all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
