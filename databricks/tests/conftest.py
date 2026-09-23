"""Test bootstrap: makes `docintel_app` importable without installing the app package, and
restricts anyio-marked async tests to the asyncio backend (trio is not part of the pinned venv).

Production (`app/requirements.txt`'s `-e .`) makes `docintel_app` importable via a real editable
install of `app/pyproject.toml`'s `src`-layout package. Tests can't use that same mechanism: the
shared `.venv` this repo's tooling runs against (`.venv/bin/pytest` etc.) has no `pip` installed
and installing into it would mutate a venv other concurrently-running agents also use, plus an
editable install would need network/build access that test collection must never touch (see
below). So this keeps the equivalent `sys.path` insertion instead — same net effect (`docintel_app`
importable), different mechanism, chosen for test-environment safety rather than fidelity.

No test in this tree touches the network: every Databricks/OpenAI/AWS client is a fake defined
in `fakes.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_APP_SRC = Path(__file__).resolve().parents[1] / "app" / "src"
if str(_APP_SRC) not in sys.path:
    sys.path.insert(0, str(_APP_SRC))


@pytest.fixture
def anyio_backend() -> str:
    """Run `@pytest.mark.anyio` tests on asyncio only."""
    return "asyncio"
