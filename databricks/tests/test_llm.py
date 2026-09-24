"""Unit tests for `llm.enrich`/`llm.FmapiClient`: structured-output validation, the one-shot
retry, and the re-authenticate-once-on-401 behaviour (item 4: the baked-in bearer token expires).
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx2
from docintel_app import llm
from docintel_app.schemas import Enrichment
from fakes import FakeOpenAI, FakeWorkspaceClient
from openai import PermissionDeniedError

_VALID_JSON = (
    '{"summary": "s", "key_points": ["a"], "entities": [{"name": "Acme", "type": "ORG"}], '
    '"topics": ["t"], "sentiment": "neutral", "language": "en"}'
)


def _client(responses: list[str], fail_times: int = 0) -> llm.FmapiClient:
    return llm.FmapiClient(FakeWorkspaceClient(), FakeOpenAI(responses, fail_times))


def test_enrich_succeeds_on_first_valid_reply() -> None:
    client = _client([_VALID_JSON])
    result = llm.enrich(client, "model-x", "some document text")

    assert isinstance(result, Enrichment)
    assert result.summary == "s"
    assert result.entities[0].name == "Acme"


def test_enrich_retries_once_after_invalid_json() -> None:
    client = _client(["not json at all", _VALID_JSON])
    result = llm.enrich(client, "model-x", "some document text")

    assert result.sentiment == "neutral"


def test_enrich_raises_if_retry_also_fails() -> None:
    client = _client(["nope", "still not json"])
    try:
        llm.enrich(client, "model-x", "text")
    except Exception as exc:
        assert type(exc).__name__ == "ValidationError"
    else:
        raise AssertionError("expected a ValidationError after the retry also fails")


def test_fmapi_client_reauthenticates_once_on_401() -> None:
    """A 401 on the first call re-authenticates and retries once, transparently to `enrich`."""
    client = _client([_VALID_JSON], fail_times=1)

    result = llm.enrich(client, "model-x", "some document text")

    assert result.summary == "s"


def test_complete_refreshes_on_permission_denied_not_just_401() -> None:
    """Databricks answers an expired bearer with 403 PermissionDeniedError: Invalid Token.

    Catching only AuthenticationError meant the refresh never fired and every enrichment failed
    once the app had been up for about an hour (observed live).
    """
    calls: list[str] = []

    class _Client:
        def with_options(self, **kwargs: object) -> _Client:
            calls.append(str(kwargs.get("api_key")))
            return self

    workspace = SimpleNamespace(
        config=SimpleNamespace(authenticate=lambda: {"Authorization": "Bearer fresh-token"})
    )
    client = llm.FmapiClient(workspace, _Client())  # type: ignore[arg-type]

    attempts = {"n": 0}

    def fake_complete(_c: object, _m: str, _msgs: object) -> str:
        attempts["n"] += 1
        if attempts["n"] == 1:
            response = httpx2.Response(403, request=httpx2.Request("POST", "https://x/y"))
            raise PermissionDeniedError("Invalid Token", response=response, body=None)
        return '{"ok": true}'

    original = llm._complete
    llm._complete = fake_complete  # type: ignore[assignment]
    try:
        assert client.complete("m", []) == '{"ok": true}'
    finally:
        llm._complete = original  # type: ignore[assignment]

    assert attempts["n"] == 2, "should retry once after the 403"
    assert calls == ["fresh-token", "fresh-token"], "token resolved per call, then refreshed"
