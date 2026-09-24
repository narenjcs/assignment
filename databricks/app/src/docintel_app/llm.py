"""Foundation Model API access and structured enrichment (DEVELOPMENT.md §4: one retry on
pydantic validation error, no regex JSON scraping).
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import cast

from databricks.sdk import WorkspaceClient
from openai import AuthenticationError, OpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import ValidationError

from docintel_app.prompts import ENRICHMENT_RETRY_SUFFIX, ENRICHMENT_SYSTEM_PROMPT
from docintel_app.schemas import Enrichment

logger = logging.getLogger(__name__)

MAX_ENRICH_CHARS = 12_000
_TIMEOUT_SECONDS = 30


def build_fmapi_client(host: str, token: str) -> OpenAI:
    """OpenAI-compatible client for a Databricks Foundation Model API serving endpoint.

    `ServingEndpointsAPI.get_open_ai_client()` does not exist on the pinned databricks-sdk
    0.140.0 (verified absent from `dir(ServingEndpointsAPI)`), so FMAPI is reached via the
    documented OpenAI-compatible `/serving-endpoints` route instead, authenticated with a
    bearer token from `WorkspaceClient().config.authenticate()`.
    """
    base_url = f"{host.rstrip('/')}/serving-endpoints"
    return OpenAI(api_key=token, base_url=base_url)


class FmapiClient:
    """Wraps an `OpenAI` FMAPI client with its `WorkspaceClient` so a 401 (the bearer token
    baked in by `build_fmapi_client` expires in ~1h) triggers exactly one re-authenticate + retry
    instead of every call failing for the rest of the process's life.
    """

    def __init__(self, workspace: WorkspaceClient, client: OpenAI) -> None:
        self._workspace = workspace
        self._client = client

    def complete(self, model: str, messages: list[dict[str, str]]) -> str:
        """One non-streaming chat-completion call, re-authenticating once on a 401."""
        try:
            return _complete(self._client, model, messages)
        except AuthenticationError:
            logger.warning("fmapi call got 401, re-authenticating once and retrying")
            auth = self._workspace.config.authenticate()
            token = auth.get("Authorization", "").removeprefix("Bearer ")
            self._client = self._client.with_options(api_key=token)
            return _complete(self._client, model, messages)


def enrich(client: FmapiClient, model: str, text: str) -> Enrichment:
    """Summarise/enrich extracted document text into a structured `Enrichment`.

    Calls the FMAPI chat-completions endpoint once, validates the JSON reply against
    `Enrichment`, and retries exactly once with the validation error fed back if it fails.
    """
    messages: list[dict[str, str]] = [
        {"role": "system", "content": ENRICHMENT_SYSTEM_PROMPT},
        {"role": "user", "content": text[:MAX_ENRICH_CHARS]},
    ]
    raw = client.complete(model, messages)
    try:
        return Enrichment.model_validate_json(raw)
    except ValidationError as exc:
        logger.warning("enrichment validation failed, retrying once: %s", exc)
        messages.append({"role": "assistant", "content": raw})
        messages.append({"role": "user", "content": ENRICHMENT_RETRY_SUFFIX.format(error=str(exc))})
        raw = client.complete(model, messages)
        return Enrichment.model_validate_json(raw)


def _complete(client: OpenAI, model: str, messages: list[dict[str, str]]) -> str:
    """One non-streaming chat-completion call, returning the assistant's text content."""
    # `messages` is built from plain dict literals (simplest to construct/test); cast to the
    # openai SDK's TypedDict union so ty can match `Completions.create`'s overloads.
    typed_messages = cast(list[ChatCompletionMessageParam], messages)
    response = client.chat.completions.create(
        model=model, messages=typed_messages, timeout=_TIMEOUT_SECONDS
    )
    return _content_text(response.choices[0].message.content)


def _content_text(content: object) -> str:
    """Flatten an assistant message's content into plain text.

    `databricks-gpt-oss-120b` returns a list of typed blocks (e.g. a `reasoning` block followed
    by a `text` block) rather than a bare string, so reading `.content` directly handed pydantic
    a list and enrichment failed with "JSON input should be string, bytes or bytearray".
    """
    if content is None:
        return "{}"
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
                continue
            value = getattr(block, "text", None)
            if value is None and isinstance(block, Mapping):
                mapping = cast("Mapping[str, object]", block)
                if mapping.get("type") == "reasoning":
                    continue  # chain-of-thought block, never the JSON answer
                value = mapping.get("text")
            if isinstance(value, str):
                parts.append(value)
        return "\n".join(parts).strip() or "{}"
    return str(content)
