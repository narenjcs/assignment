"""Typed runtime settings, read once from the process environment.

DEVELOPMENT.md §12: config is read once into a typed object; nothing else in this package
touches `os.environ` directly. `pydantic-settings` is not part of the pinned dependency set
(requirements.txt), so this uses a plain `BaseModel` with an explicit `from_env()` loader
instead of `BaseSettings`.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from pydantic import BaseModel, Field


class Settings(BaseModel):
    """Validated configuration for the MCP server, agent, and job entry point."""

    warehouse_id: str = Field(min_length=1)
    llm_endpoint: str = Field(min_length=1, default="databricks-gpt-oss-120b")
    catalog: str = Field(min_length=1, default="docintel")
    schema_name: str = Field(min_length=1, default="docs")
    aws_gateway_url: str = Field(min_length=1)
    aws_mcp_token_url: str = Field(min_length=1)
    aws_mcp_client_id: str = Field(min_length=1)
    aws_mcp_client_secret: str = Field(min_length=1)
    aws_mcp_scope: str = Field(min_length=1)
    aws_secret_scope: str = "docintel"
    """Databricks secret scope; the async job reads the AWS gateway token from here."""

    @property
    def uc_table(self) -> str:
        """Fully qualified `document_results` table name."""
        return f"{self.catalog}.{self.schema_name}.document_results"

    @property
    def volume_path(self) -> str:
        """Root UC volume directory the PDF agent ingests files into."""
        return f"/Volumes/{self.catalog}/{self.schema_name}/inbox"


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Build `Settings` from `env` (defaults to `os.environ`).

    The `env` parameter exists purely for dependency injection in tests; production code calls
    `load_settings()` with no arguments exactly once, at process startup.
    """
    source = env if env is not None else os.environ
    return Settings(
        warehouse_id=source.get("DATABRICKS_WAREHOUSE_ID", ""),
        llm_endpoint=source.get("DATABRICKS_LLM_ENDPOINT", "databricks-gpt-oss-120b"),
        catalog=source.get("DOCINTEL_CATALOG", "docintel"),
        schema_name=source.get("DOCINTEL_SCHEMA", "docs"),
        aws_gateway_url=source.get("AWS_GATEWAY_URL", ""),
        aws_mcp_token_url=source.get("AWS_MCP_TOKEN_URL", ""),
        aws_mcp_client_id=source.get("AWS_MCP_CLIENT_ID", ""),
        aws_mcp_client_secret=source.get("AWS_MCP_CLIENT_SECRET", ""),
        aws_mcp_scope=source.get("AWS_MCP_SCOPE", ""),
        aws_secret_scope=source.get("AWS_SECRET_SCOPE", "docintel"),
    )
