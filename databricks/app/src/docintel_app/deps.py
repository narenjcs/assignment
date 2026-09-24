"""Runtime dependency container: built once at server startup, closed over by every MCP tool."""

from __future__ import annotations

from dataclasses import dataclass

from databricks.sdk import WorkspaceClient

from docintel_app import llm
from docintel_app.aws_mcp import AwsToolBackend
from docintel_app.config import Settings
from docintel_app.llm import FmapiClient


@dataclass(frozen=True)
class Deps:
    """Everything a tool needs: settings, the UC/jobs client, the FMAPI client, AWS backend."""

    settings: Settings
    workspace: WorkspaceClient
    llm_client: FmapiClient
    aws: AwsToolBackend


def build_deps(settings: Settings, *, aws_token: str | None = None) -> Deps:
    """Build the real `Deps`: a Databricks SDK client, an FMAPI client, and the AWS backend.

    Deliberately lives here (not in `server.py`) so it has no `fastapi` import: the serverless
    job (`jobs/pdf_agent_job.py`) calls this too, and its environment (`resources/jobs.yml`)
    doesn't install `fastapi`/`uvicorn` (only `mcp`, which this module's transitive imports do
    use via `aws_mcp.py`, is present there).
    """
    workspace = WorkspaceClient()
    token = workspace.config.authenticate().get("Authorization", "").removeprefix("Bearer ")
    openai_client = llm.build_fmapi_client(workspace.config.host, token)
    llm_client = FmapiClient(workspace, openai_client)
    return Deps(
        settings=settings,
        workspace=workspace,
        llm_client=llm_client,
        aws=AwsToolBackend(settings, token=aws_token),
    )
