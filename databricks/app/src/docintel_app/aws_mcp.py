"""AWS MCP Gateway client: Cognito M2M auth plus a thin async tool-call backend.

`cognito_m2m_token`/`_post_form`/`_cached` are ported from
`aws/common/docintel_common/auth.py` (not imported — this package must not depend on the AWS
Lambda layer), kept dependency-free on urllib. Every call retries with jittered backoff
(DEVELOPMENT.md G8: cross-cloud calls need an explicit timeout and retry with backoff).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import random
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from docintel_app.config import Settings

logger = logging.getLogger(__name__)

_tokens: dict[str, tuple[float, str]] = {}

_MAX_ATTEMPTS = 3
_BASE_DELAY_SECONDS = 0.5
_CALL_TIMEOUT_SECONDS = 30


def _post_form(
    url: str, data: dict[str, str], headers: dict[str, str] | None = None, timeout: int = 20
) -> dict[str, Any]:
    """Dependency-free (urllib) form POST, ported from aws/common/docintel_common/auth.py."""
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _cached(key: str, fetch: Callable[[], dict[str, Any]]) -> str:
    """In-memory token cache, refreshing 60s before expiry."""
    hit = _tokens.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    payload = fetch()
    token = payload["access_token"]
    ttl = int(payload.get("expires_in", 3600))
    _tokens[key] = (time.time() + max(60, ttl - 60), token)
    return token


def cognito_m2m_token(token_url: str, client_id: str, client_secret: str, scope: str) -> str:
    """Cognito client-credentials grant used to authenticate to the AWS MCP Gateway."""
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    form = {"grant_type": "client_credentials", "scope": scope}
    headers = {"Authorization": f"Basic {basic}"}
    return _cached(f"cognito:{client_id}:{scope}", lambda: _post_form(token_url, form, headers))


class AwsToolBackend:
    """Calls tools on the AWS MCP Gateway over streamable HTTP, with Cognito bearer auth."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call one AWS Gateway MCP tool by name, retrying transient failures with backoff."""
        last_error: Exception | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                return await self._call_once(name, arguments)
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "aws mcp call %s failed (attempt %d/%d): %s",
                    name,
                    attempt + 1,
                    _MAX_ATTEMPTS,
                    exc,
                )
                if attempt < _MAX_ATTEMPTS - 1:
                    delay = _BASE_DELAY_SECONDS * (2**attempt) + random.uniform(0, 0.25)
                    await asyncio.sleep(delay)
        raise last_error or RuntimeError(f"aws mcp call {name} failed with no captured error")

    async def _call_once(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Single attempt: open an MCP session, call the tool, and unwrap its result."""
        settings = self._settings
        # `cognito_m2m_token` is a blocking `urllib` call; run it off the event loop so one PDF
        # job's token fetch/refresh doesn't stall `/api/health` and other concurrent MCP calls.
        token = await asyncio.to_thread(
            cognito_m2m_token,
            settings.aws_mcp_token_url,
            settings.aws_mcp_client_id,
            settings.aws_mcp_client_secret,
            settings.aws_mcp_scope,
        )
        http_client = httpx2.AsyncClient(
            headers={"Authorization": f"Bearer {token}"}, timeout=_CALL_TIMEOUT_SECONDS
        )
        transport = streamable_http_client(settings.aws_gateway_url, http_client=http_client)
        async with Client(transport) as client:
            result = await client.call_tool(name, arguments)
        return _unwrap(result)


def _unwrap(result: Any) -> dict[str, Any]:
    """Extract the tool's `{ok, data|error}` dict from an MCP `CallToolResult`.

    Raises if the MCP protocol itself reports an error (`result.is_error`) — a transport/
    protocol-level failure, distinct from the tool succeeding at the protocol level but
    returning `{ok: false}` in its own envelope. `AwsToolBackend.call`'s retry loop treats a
    raise here as transient and retries with backoff; callers (`agent.py`) check the returned
    `{ok: false}` envelope explicitly, since that's a business-logic failure to react to, not a
    transport error to retry.
    """
    if getattr(result, "is_error", False):
        text = getattr(result.content[0], "text", None) if result.content else None
        raise RuntimeError(f"AWS MCP tool call reported is_error: {text or result}")
    if result.structured_content is not None:
        return dict(result.structured_content)
    if result.content:
        text = getattr(result.content[0], "text", "{}")
        return json.loads(text)
    return {}
