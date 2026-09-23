"""`enrich_document` MCP tool: summarise/analyse extracted text via the FMAPI LLM endpoint."""

from __future__ import annotations

import asyncio
from typing import Any

from docintel_app import llm
from docintel_app.deps import Deps
from docintel_app.schemas import ok_result
from docintel_app.tools import ToolFn, guarded


def build_enrich_document(deps: Deps) -> ToolFn:
    """Build the `enrich_document` tool, closing over `deps`."""

    @guarded
    async def enrich_document(text: str) -> dict[str, Any]:
        """Summarise, tag, and analyse sentiment/entities for extracted document text.

        Calls the Foundation Model API once, validating the structured JSON reply and
        retrying once on validation failure. Truncates very long text before sending it.
        Runs on a worker thread (`llm.enrich` is a blocking HTTP call) so it doesn't stall
        the event loop — `/api/health` and other MCP calls keep responding while this runs.
        """
        enrichment = await asyncio.to_thread(
            llm.enrich, deps.llm_client, deps.settings.llm_endpoint, text
        )
        return ok_result(enrichment.model_dump())

    return enrich_document
