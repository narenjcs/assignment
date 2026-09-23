"""`ingest_pdf` MCP tool: download a PDF from AWS and land it in the UC inbox volume."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from docintel_app import uc
from docintel_app.deps import Deps
from docintel_app.schemas import err_result, ok_result
from docintel_app.tools import ToolFn, guarded


def build_ingest_pdf(deps: Deps) -> ToolFn:
    """Build the `ingest_pdf` tool, closing over `deps`."""

    @guarded
    async def ingest_pdf(job_id: str, download_url: str, file_name: str) -> dict[str, Any]:
        """Download a PDF from a presigned AWS URL into the UC inbox volume.

        Call this first for every job. Side effect: writes/overwrites
        `{volume}/{job_id}_{file_name}` in Unity Catalog. Safe to call again for the same
        job_id (overwrites the previous copy).
        """
        safe_name = os.path.basename(file_name).strip()
        if not safe_name:
            return err_result("invalid_file_name", f"file_name {file_name!r} is empty/unsafe")
        # `uc.download_pdf`/`uc.upload_to_volume` are blocking network calls; run them on a
        # worker thread so one PDF job doesn't stall `/api/health` and other MCP calls.
        content = await asyncio.to_thread(uc.download_pdf, download_url)
        volume_path = f"{deps.settings.volume_path}/{job_id}_{safe_name}"
        await asyncio.to_thread(uc.upload_to_volume, deps.workspace, volume_path, content)
        return ok_result({"volume_path": volume_path, "byte_count": len(content)})

    return ingest_pdf
