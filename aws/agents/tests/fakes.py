"""In-memory test doubles shared across the suite (DEVELOPMENT.md §9 DI-by-parameter means
every collaborator here is injectable, so nothing below needs the network or real AWS)."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import cast

# `Mapping`/`Sequence` (not `dict`/`list`) so a concretely-typed literal (e.g.
# `dict[str, bool | dict[str, str]]`) passed by a caller satisfies this parameter without
# tripping ty's dict-invariance check - see
# https://docs.astral.sh/ty/reference/typing-faq/#invariant-generics.
ScriptedResponses = Mapping[str, Mapping[str, object] | Sequence[Mapping[str, object]]]


class FakeToolBackend:
    """A `docintel_common.mcp_backend.ToolBackend` that returns scripted responses.

    `responses` maps a tool name to either a single payload dict (returned every call) or a
    list of payload dicts (returned one per call, last one repeats once exhausted) - the list
    form lets `DatabricksPdfProcessor` polling tests simulate "still running" then "done".
    """

    def __init__(self, responses: ScriptedResponses) -> None:
        self._responses = responses
        self.calls: list[tuple[str, dict]] = []
        self.read_timeouts: list[float] = []

    def call(self, name: str, args: dict, *, read_timeout_seconds: float = 120.0) -> dict:
        self.calls.append((name, args))
        self.read_timeouts.append(read_timeout_seconds)
        response = self._responses.get(name, {"ok": True, "data": {}})
        if isinstance(response, Sequence):
            index = min(len([c for c in self.calls if c[0] == name]) - 1, len(response) - 1)
            return cast("dict", response[index])
        return cast("dict", response)


def fake_llm_call(replies: list[str]) -> Callable[[str], object]:
    """Build an `enrich.LlmCall`-shaped fake: returns `replies` in order, then repeats the last."""
    state = {"i": 0}

    async def call(_prompt: str) -> str:
        index = min(state["i"], len(replies) - 1)
        state["i"] += 1
        return replies[index]

    return call
