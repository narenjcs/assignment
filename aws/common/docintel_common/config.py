"""Environment-driven configuration for the two AgentCore agents (all values injected by CDK).

`docintel-jobs` itself is never read here: agents only see DynamoDB through AWS Gateway MCP
tools (PLAN.md §2.1.1), so job/table/bucket details belong to the TypeScript Lambdas, not here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

STATUSES = ("PENDING_UPLOAD", "UPLOADED", "QUEUED", "PROCESSING", "COMPLETED", "FAILED")


class MissingConfigError(RuntimeError):
    """Raised when a required environment variable is absent (fail fast at startup)."""


@dataclass(frozen=True)
class Settings:
    """Agent runtime configuration, read once from the environment (CDK sets these)."""

    region: str
    bedrock_model_id: str
    gateway_url: str
    aws_mcp_secret_arn: str
    databricks_secret_arn: str
    docx_agent_arn: str
    job_ttl_days: int

    @classmethod
    def from_env(cls) -> Settings:
        """Build `Settings` from `os.environ`, matching the CDK runtime env vars.

        `BEDROCK_MODEL_ID` has no built-in fallback (project CLAUDE.md rule 4: "Model ids come
        from env/CDK context, never hard-coded") - a missing value fails fast here rather than
        silently running against a stale default model.
        """
        return cls(
            region=(
                os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"
            ),
            bedrock_model_id=_require_env("BEDROCK_MODEL_ID"),
            gateway_url=os.environ.get("GATEWAY_URL", ""),
            aws_mcp_secret_arn=os.environ.get("AWS_MCP_SECRET_ARN", ""),
            databricks_secret_arn=os.environ.get("DATABRICKS_SECRET_ARN", ""),
            docx_agent_arn=os.environ.get("DOCX_AGENT_ARN", ""),
            job_ttl_days=int(os.environ.get("JOB_TTL_DAYS", "7")),
        )


def _require_env(name: str) -> str:
    """Return `os.environ[name]`, raising `MissingConfigError` if unset or empty."""
    value = os.environ.get(name, "")
    if not value:
        raise MissingConfigError(f"{name} is required but not set")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached `Settings` factory (DEVELOPMENT.md §9 "Factory with cache")."""
    return Settings.from_env()
