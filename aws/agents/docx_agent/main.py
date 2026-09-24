"""AgentCore entrypoint for the DOCX agent (T4.1): extract -> enrich -> save (PLAN.md §2.2).

Verified against `bedrock_agentcore.BedrockAgentCoreApp`/`RequestContext` and
`strands.models.BedrockModel`/`strands.Agent.invoke_async` (bedrock-agentcore==1.23.1,
strands-agents==1.57.0): `@app.entrypoint` wraps `async def handler(payload, context) -> dict`;
`context.session_id: str | None`; `BedrockModel(region_name=, model_id=, max_tokens=,
temperature=)`; `Agent(model=, tools=, system_prompt=, callback_handler=)`;
`Agent.invoke_async(prompt) -> AgentResult` (`str(result)` gives the model's text reply).
"""

from __future__ import annotations

import logging

from bedrock_agentcore import BedrockAgentCoreApp, RequestContext
from docintel_common import secrets
from docintel_common.config import get_settings
from docintel_common.mcp_backend import GATEWAY_TOOL_PREFIX, McpToolBackend, gateway_client
from enrich import LlmCall, run_docx_job
from prompts import SYSTEM_PROMPT
from strands import Agent
from strands.models import BedrockModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("docx_agent")

app = BedrockAgentCoreApp()
settings = get_settings()


@app.entrypoint
async def handler(payload: dict, context: RequestContext) -> dict:
    """Run one DOCX job end-to-end; returns `{ok, jobId, result|error}`."""
    job_id = payload["jobId"]
    logger.info("docx job starting", extra={"job_id": job_id, "session_id": context.session_id})
    secret = secrets.get_secret_json(settings.aws_mcp_secret_arn, region=settings.region)
    with gateway_client(settings.gateway_url, secret) as client:
        backend = McpToolBackend(client, tool_prefix=GATEWAY_TOOL_PREFIX)
        event = await run_docx_job(backend, _build_llm_call(), job_id, settings.bedrock_model_id)
    return _to_response(job_id, event)


def _build_llm_call() -> LlmCall:
    model = BedrockModel(
        region_name=settings.region,
        model_id=settings.bedrock_model_id,
        max_tokens=2048,
        temperature=0.2,
    )
    agent = Agent(model=model, tools=[], system_prompt=SYSTEM_PROMPT, callback_handler=None)

    async def call(prompt: str) -> str:
        result = await agent.invoke_async(prompt)
        return str(result)

    return call


def _to_response(job_id: str, event: dict) -> dict:
    if event["type"] == "result":
        return {"ok": True, "jobId": job_id, "result": event["result"]}
    return {"ok": False, "jobId": job_id, "error": event["error"]}


if __name__ == "__main__":
    app.run()
