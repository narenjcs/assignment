"""OAuth client-credentials helpers (Cognito for the AWS MCP Gateway, Databricks OIDC for the App).

Dependency-free (urllib) so it can be vendored into Lambdas and Databricks jobs alike.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.parse
import urllib.request
from collections.abc import Callable

_tokens: dict[str, tuple[float, str]] = {}


def _post_form(url: str, data: dict, headers: dict | None = None, timeout: int = 20) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _cached(key: str, fetch: Callable[[], dict]) -> str:
    hit = _tokens.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    payload = fetch()
    token = payload["access_token"]
    ttl = int(payload.get("expires_in", 3600))
    _tokens[key] = (time.time() + max(60, ttl - 60), token)
    return token


def cognito_m2m_token(token_url: str, client_id: str, client_secret: str, scope: str) -> str:
    """Cognito client-credentials grant (used for the AgentCore Gateway JWT authorizer)."""
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    form = {"grant_type": "client_credentials", "scope": scope}
    headers = {"Authorization": f"Basic {basic}"}
    return _cached(f"cognito:{client_id}:{scope}", lambda: _post_form(token_url, form, headers))


def databricks_m2m_token(host: str, client_id: str, client_secret: str) -> str:
    """Databricks service-principal OAuth M2M token (`all-apis` scope, 1h lifetime)."""
    host = host.rstrip("/")
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    form = {"grant_type": "client_credentials", "scope": "all-apis"}
    headers = {"Authorization": f"Basic {basic}"}
    return _cached(
        f"databricks:{host}:{client_id}", lambda: _post_form(f"{host}/oidc/v1/token", form, headers)
    )
