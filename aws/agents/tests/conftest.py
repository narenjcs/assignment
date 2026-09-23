"""Test bootstrap: makes `docintel_common` and each agent's flat sibling modules importable
without touching the network, and isolates the two agents' same-named files (both have
`main.py`/`prompts.py` at their zip root - the AgentCore flat deploy layout described in
`aws/agents/build.sh`) from colliding with each other in `sys.modules`.

No `pytest-asyncio` plugin is installed in the shared `.venv` (requirements-dev.txt pins only
`pytest`), so async test bodies use the `run_async()` helper below instead of `async def test_*`.
"""

from __future__ import annotations

import asyncio
import importlib
import os
import sys
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

# `orchestrator/main.py` calls `docintel_common.config.get_settings()` at import time, which
# (per project CLAUDE.md rule 4) now requires `BEDROCK_MODEL_ID` to be set - no hard-coded
# fallback. `setdefault` runs at collection time, before any test module imports `main`, and
# never clobbers a value a developer/CI already set in the real environment.
os.environ.setdefault("BEDROCK_MODEL_ID", "test.fake-model-id")

TESTS_DIR = Path(__file__).resolve().parent
AGENTS_DIR = TESTS_DIR.parent
REPO_ROOT = AGENTS_DIR.parent.parent
COMMON_DIR = REPO_ROOT / "aws" / "common"

_AGENT_NAMES = ("docx_agent", "orchestrator")
_FLAT_MODULE_NAMES = (
    "main",
    "prompts",
    "schemas",
    "enrich",
    "workflow",
    "processors",
    "tools",
    "events",
)

if str(COMMON_DIR) not in sys.path:
    sys.path.insert(0, str(COMMON_DIR))


def import_agent_module(agent: str, module: str) -> Any:
    """Import `module` (e.g. "main") from `aws/agents/<agent>/`, isolated from the other
    agent's identically-named flat sibling modules.

    Evicts any previously-cached flat module of the same name and makes sure only `agent`'s
    own directory (never both agents') is on `sys.path` before importing, so `enrich.py`'s
    `from prompts import ...` (and similar) resolve to the right agent every time regardless
    of which test file ran first.
    """
    if agent not in _AGENT_NAMES:
        raise ValueError(f"unknown agent {agent!r}, expected one of {_AGENT_NAMES}")
    for name in _FLAT_MODULE_NAMES:
        sys.modules.pop(name, None)
    for other in _AGENT_NAMES:
        other_dir = str(AGENTS_DIR / other)
        if other_dir in sys.path:
            sys.path.remove(other_dir)
    sys.path.insert(0, str(AGENTS_DIR / agent))
    return importlib.import_module(module)


def run_async[T](coro: Coroutine[Any, Any, T]) -> T:
    """Run one coroutine to completion in a fresh event loop (stand-in for pytest-asyncio)."""
    return asyncio.run(coro)
