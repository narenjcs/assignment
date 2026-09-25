"""`ingest_pdf` MCP tool: download a PDF from AWS and land it in the UC inbox volume."""

from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Any

from docintel_app import uc
from docintel_app.deps import Deps
from docintel_app.schemas import err_result, ok_result
from docintel_app.tools import ToolFn, guarded

logger = logging.getLogger(__name__)


async def _fetch_via_gateway(deps: Deps, job_id: str) -> bytes:
    """Fetch the document bytes through the AWS MCP Gateway (`get_document_content`)."""
    result = await deps.aws.call("get_document_content", {"job_id": job_id})
    if not result.get("ok"):
        raise RuntimeError(f"get_document_content failed: {result.get('error')}")
    return base64.b64decode(result["data"]["contentBase64"], validate=True)


async def _fetch_pdf(deps: Deps, job_id: str, download_url: str) -> bytes:
    """Gateway first, presigned URL as the fallback.

    Serverless egress here resets every connection to S3 (PLAN.md §0.1 item 1), so the
    presigned URL is unusable from Databricks; the Gateway is the one AWS endpoint that is
    reachable. The URL path is kept for workspaces where S3 is reachable, and so an AWS stack
    that predates `get_document_content` still works.
    """
    try:
        return await _fetch_via_gateway(deps, job_id)
    except Exception as gateway_exc:
        logger.warning("gateway fetch failed for job %s, trying URL: %s", job_id, gateway_exc)
        try:
            # Blocking urllib call; keep it off the event loop so `/api/health` stays live.
            return await asyncio.to_thread(uc.download_pdf, download_url)
        except Exception as url_exc:
            raise RuntimeError(f"gateway: {gateway_exc}; presigned url: {url_exc}") from url_exc


def build_ingest_pdf(deps: Deps) -> ToolFn:
    """Build the `ingest_pdf` tool, closing over `deps`."""

    @guarded
    async def ingest_pdf(job_id: str, download_url: str, file_name: str) -> dict[str, Any]:
        """Fetch a job's PDF from AWS into the UC inbox volume.

        Call this first for every job. Fetches the bytes through the AWS MCP Gateway, falling
        back to the presigned `download_url`. Side effect: writes/overwrites
        `{volume}/{job_id}_{file_name}` in Unity Catalog. Safe to call again for the same
        job_id (overwrites the previous copy).
        """
        safe_name = os.path.basename(file_name).strip()
        if not safe_name:
            return err_result("invalid_file_name", f"file_name {file_name!r} is empty/unsafe")
        content = await _fetch_pdf(deps, job_id, download_url)
        volume_path = f"{deps.settings.volume_path}/{job_id}_{safe_name}"
        await asyncio.to_thread(uc.upload_to_volume, deps.workspace, volume_path, content)
        return ok_result({"volume_path": volume_path, "byte_count": len(content)})

    return ingest_pdf
