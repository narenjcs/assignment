"""Network-free fakes for the Databricks SDK, OpenAI, and the AWS MCP backend, shared by every
test module. Duck-typed rather than subclassed: `ty check` only covers `databricks/app/src`, so
these do not need to satisfy the real SDK types, only the attributes/methods the app code uses.
"""

from __future__ import annotations

import io
from types import SimpleNamespace
from typing import Any

import httpx
from databricks.sdk.service.sql import StatementState
from docintel_app.config import Settings
from docintel_app.deps import Deps
from docintel_app.llm import FmapiClient
from openai import AuthenticationError


class FakeStatementExecution:
    """Fake `WorkspaceClient().statement_execution`. Every call is immediately terminal, so
    `uc._await_terminal`'s polling loop never runs.
    """

    def __init__(self, rows_by_prefix: dict[str, list[list[str]]] | None = None) -> None:
        self.calls: list[tuple[str, list[Any]]] = []
        self._rows_by_prefix = rows_by_prefix or {}

    def execute_statement(
        self,
        *,
        statement: str,
        warehouse_id: str,
        parameters: list[Any] | None = None,
        wait_timeout: str | None = None,
    ) -> SimpleNamespace:
        self.calls.append((statement, parameters or []))
        rows: list[list[str]] = []
        upper = statement.strip().upper()
        for prefix, data in self._rows_by_prefix.items():
            if upper.startswith(prefix):
                rows = data
                break
        return SimpleNamespace(
            statement_id="stmt-1",
            status=SimpleNamespace(state=StatementState.SUCCEEDED, error=None),
            result=SimpleNamespace(data_array=rows),
        )

    def get_statement(self, statement_id: str) -> SimpleNamespace:
        raise AssertionError(f"polling not expected in tests (statement_id={statement_id})")


class FakeFiles:
    """Fake `WorkspaceClient().files`: an in-memory dict standing in for a UC volume."""

    def __init__(self) -> None:
        self.uploaded: dict[str, bytes] = {}

    def upload(self, path: str, stream: io.BytesIO, overwrite: bool = True) -> None:
        self.uploaded[path] = stream.read()

    def download(self, path: str) -> SimpleNamespace:
        content = self.uploaded.get(path, b"%PDF-1.4 fake pdf bytes")
        return SimpleNamespace(contents=io.BytesIO(content))


class FakeJobs:
    """Fake `WorkspaceClient().jobs`, for `run_pdf_agent(mode="async")`/`get_pdf_run_status`."""

    def __init__(
        self,
        job_id: int | None = 42,
        life_cycle_state: str = "TERMINATED",
        result_state: str | None = "SUCCESS",
        run_job_parameters: dict[str, str] | None = None,
    ) -> None:
        self._job_id = job_id
        self._life_cycle_state = life_cycle_state
        self._result_state = result_state
        self._run_job_parameters = run_job_parameters or {}
        self.run_now_calls: list[tuple[int, dict[str, str]]] = []

    def list(self, name: str | None = None) -> Any:
        if self._job_id is None:
            return iter([])
        return iter([SimpleNamespace(job_id=self._job_id)])

    def run_now(self, *, job_id: int, job_parameters: dict[str, str]) -> SimpleNamespace:
        self.run_now_calls.append((job_id, job_parameters))
        return SimpleNamespace(run_id=999)

    def get_run(self, run_id: int) -> SimpleNamespace:
        job_parameters = [
            SimpleNamespace(name=name, value=value, default=None)
            for name, value in self._run_job_parameters.items()
        ]
        return SimpleNamespace(
            state=SimpleNamespace(
                life_cycle_state=self._life_cycle_state,
                result_state=self._result_state,
                state_message="ok",
            ),
            job_parameters=job_parameters,
        )


class FakeWorkspaceClient:
    """Fake `databricks.sdk.WorkspaceClient`: only the surface `uc.py`/`tools/runs.py` use."""

    def __init__(self, rows_by_prefix: dict[str, list[list[str]]] | None = None) -> None:
        self.statement_execution = FakeStatementExecution(rows_by_prefix)
        self.files = FakeFiles()
        self.jobs = FakeJobs()
        self.config = SimpleNamespace(
            authenticate=lambda: {"Authorization": "Bearer refreshed-token"}, host="https://fake"
        )


class FakeChatCompletions:
    """Fake `OpenAI().chat.completions`, replaying canned responses in order.

    `fail_times` makes the first N calls raise `openai.AuthenticationError` (a 401), for testing
    `llm.FmapiClient`'s re-authenticate-once-and-retry behaviour.
    """

    def __init__(self, responses: list[str], fail_times: int = 0) -> None:
        self._responses = list(responses)
        self.calls: list[list[dict[str, str]]] = []
        self._fail_times = fail_times

    def create(
        self, *, model: str, messages: list[dict[str, str]], timeout: int
    ) -> SimpleNamespace:
        self.calls.append(messages)
        if self._fail_times > 0:
            self._fail_times -= 1
            request = httpx.Request("POST", "https://fake/serving-endpoints")
            response = httpx.Response(401, request=request, json={"error": {"message": "expired"}})
            raise AuthenticationError(message="expired token", response=response, body=None)
        content = self._responses.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class FakeOpenAI:
    """Fake `openai.OpenAI` client, only the `chat.completions.create`/`with_options` surface
    `llm.py` uses.
    """

    def __init__(self, responses: list[str], fail_times: int = 0) -> None:
        self.chat = SimpleNamespace(completions=FakeChatCompletions(responses, fail_times))

    def with_options(self, *, api_key: str) -> FakeOpenAI:
        """Return self: the fake doesn't care about `api_key`, it just stops failing."""
        self.chat.completions._fail_times = 0
        return self


class FakeAwsBackend:
    """Fake `AwsToolBackend`: records every call and replays canned `{ok, data}` envelopes."""

    def __init__(self, responses: dict[str, dict[str, Any]] | None = None) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._responses = responses or {}

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, arguments))
        return self._responses.get(name, {"ok": True, "data": {}})


def make_settings(**overrides: str) -> Settings:
    """Build a valid `Settings` for tests, with every required field filled in by default."""
    values: dict[str, str] = {
        "warehouse_id": "wh-1",
        "aws_gateway_url": "https://aws.example/mcp",
        "aws_mcp_token_url": "https://aws.example/token",
        "aws_mcp_client_id": "client-1",
        "aws_mcp_client_secret": "secret-1",
        "aws_mcp_scope": "docintel/invoke",
    }
    values.update(overrides)
    return Settings(**values)


def make_deps(
    *,
    rows_by_prefix: dict[str, list[list[str]]] | None = None,
    llm_responses: list[str] | None = None,
    llm_fail_times: int = 0,
    aws_responses: dict[str, dict[str, Any]] | None = None,
) -> Deps:
    """Build a `Deps` wired entirely to the fakes above; safe to use with no network access."""
    workspace = FakeWorkspaceClient(rows_by_prefix)
    fake_openai = FakeOpenAI(llm_responses or ["{}"], llm_fail_times)
    return Deps(
        settings=make_settings(),
        workspace=workspace,
        llm_client=FmapiClient(workspace, fake_openai),
        aws=FakeAwsBackend(aws_responses),
    )
