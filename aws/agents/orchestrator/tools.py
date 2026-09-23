"""Adapter/Factory layer: the Strands `Agent` (MCP tools + local `delegate_to_docx_agent`) and
the per-invocation `workflow_session` that wires everything into a `WorkflowDeps`.

Verified against `strands.tool`/`DecoratedFunctionTool` and `boto3` `bedrock-agentcore`'s
`InvokeAgentRuntime` (required: `agentRuntimeArn`, `payload`; both `payload`/`response` are
blobs) (strands-agents==1.57.0): a `@tool`-decorated function stays directly callable as a plain
Python function (confirmed: `add(2, 3) == 5` on a toy `@tool def add(a, b): ...`), so
`delegate_to_docx_agent` below is both an LLM-callable tool and `_delegate`'s thin production
wrapper. `botocore.config.Config(read_timeout=, connect_timeout=, retries=)` verified directly
against the installed `botocore` (all three kwargs accepted and stored as given).
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from functools import lru_cache

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from docintel_common import secrets
from docintel_common.config import Settings, get_settings
from docintel_common.mcp_backend import (
    McpToolBackend,
    databricks_client,
    gateway_client,
    require_ok,
)
from docintel_common.text import truncate_message
from events import map_stream_event
from processors import AwsDocxProcessor, DatabricksPdfProcessor
from prompts import SYSTEM_PROMPT
from strands import Agent, tool
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from workflow import AGENT_NAME, WorkflowDeps

logger = logging.getLogger(__name__)

_DOCX_DELEGATE_CONFIG = Config(read_timeout=600, connect_timeout=10, retries={"max_attempts": 0})
"""A DOCX run can take several minutes; a 600s read timeout keeps a slow run from being cut off,
and disabling botocore's own retries keeps a transport hiccup from double-invoking the runtime
(`invoke_agent_runtime` is not idempotent)."""


@lru_cache(maxsize=1)
def get_agentcore_client(region: str) -> BaseClient:
    """Cached `bedrock-agentcore` client (DEVELOPMENT.md §9 "Factory with cache")."""
    return boto3.client("bedrock-agentcore", region_name=region, config=_DOCX_DELEGATE_CONFIG)


def _delegate(job_id: str, mode: str, client: BaseClient, agent_arn: str) -> dict:
    """Invoke the DOCX AgentCore runtime and parse its `{ok, jobId, result|error}` response."""
    response = client.invoke_agent_runtime(
        agentRuntimeArn=agent_arn,
        runtimeSessionId=f"{job_id}-docx-{mode}",
        contentType="application/json",
        accept="application/json",
        payload=json.dumps({"jobId": job_id}).encode(),
    )
    body = response["response"].read()
    return dict(json.loads(body))


def _build_delegate(settings: Settings) -> Callable[[str, str], dict]:
    client = get_agentcore_client(settings.region)
    return lambda job_id, mode: _delegate(job_id, mode, client, settings.docx_agent_arn)


@tool
def delegate_to_docx_agent(job_id: str, mode: str) -> dict:
    """Delegate a DOCX job to the DOCX AgentCore runtime and return its structured result.

    Use this only when the job's docType is "docx". It synchronously invokes the DOCX agent
    runtime and returns the JSON payload `{ok, jobId, result|error}` it produces.

    Args:
        job_id: The job id (uuid) to process.
        mode: "sync" or "async" - forwarded into the DOCX agent's session id for tracing.
    """
    settings = get_settings()
    client = get_agentcore_client(settings.region)
    return _delegate(job_id, mode, client, settings.docx_agent_arn)


def build_agent(aws_client: MCPClient, dbx_client: MCPClient, settings: Settings) -> Agent:
    """Build the Strands `Agent` used for synthesis and chat (PLAN §3 model selection)."""
    model = BedrockModel(
        region_name=settings.region,
        model_id=settings.bedrock_model_id,
        max_tokens=1024,
        temperature=0.3,
    )
    return Agent(
        model=model,
        tools=[aws_client, dbx_client, delegate_to_docx_agent],
        system_prompt=SYSTEM_PROMPT,
        callback_handler=None,
    )


async def stream_llm(agent: Agent, job_id: str, prompt: str) -> AsyncIterator[dict]:
    """Stream `prompt` through `agent`, mapping each event to an SSE dict via `events.py`."""
    tool_uses: dict[str, str] = {}
    async for raw_event in agent.stream_async(prompt):
        mapped = map_stream_event(job_id, dict(raw_event), tool_uses)
        if mapped is not None:
            yield mapped


@contextmanager
def workflow_session(settings: Settings) -> Iterator[WorkflowDeps]:
    """Open both MCP clients for one invocation and yield a fully-wired `WorkflowDeps`.

    MCP clients are opened here (never at import time, DEVELOPMENT.md §12) and closed when the
    `with` block exits, so a single job's tool calls all share one session.
    """
    aws_secret = secrets.get_secret_json(settings.aws_mcp_secret_arn, region=settings.region)
    dbx_secret = secrets.get_secret_json(settings.databricks_secret_arn, region=settings.region)
    with (
        gateway_client(settings.gateway_url, aws_secret) as aws_client,
        databricks_client(dbx_secret) as dbx_client,
    ):
        aws_backend = McpToolBackend(aws_client)
        dbx_backend = McpToolBackend(dbx_client)
        agent = build_agent(aws_client, dbx_client, settings)
        yield WorkflowDeps(
            aws_backend=aws_backend,
            docx_processor=AwsDocxProcessor(delegate=_build_delegate(settings)),
            pdf_processor=DatabricksPdfProcessor(
                aws_backend=aws_backend, databricks_backend=dbx_backend
            ),
            stream_llm=lambda job_id, prompt: stream_llm(agent, job_id, prompt),
        )


def mark_job_failed_best_effort(settings: Settings, job_id: str, message: str) -> None:
    """Write a FAILED status for `job_id` using a fresh, minimal AWS MCP session.

    For use when `workflow_session` itself fails (secrets lookup, token exchange, MCP connect)
    before a `WorkflowDeps` even exists to run `workflow.py`'s own FAILED-marking path - opens
    just the AWS gateway client, best-effort (never raises; logs loudly on failure) so a broken
    status write can't mask the original error from the caller.
    """
    try:
        aws_secret = secrets.get_secret_json(settings.aws_mcp_secret_arn, region=settings.region)
        with gateway_client(settings.gateway_url, aws_secret) as aws_client:
            backend = McpToolBackend(aws_client)
            require_ok(
                backend.call(
                    "update_job_status",
                    {
                        "job_id": job_id,
                        "status": "FAILED",
                        "source": "orchestrator",
                        "agent": AGENT_NAME,
                        "message": truncate_message(message),
                    },
                ),
                "update_job_status",
            )
    except Exception:
        logger.error(
            "failed to mark job FAILED after workflow_session error", extra={"job_id": job_id}
        )
