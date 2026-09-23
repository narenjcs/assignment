"""MCP tool implementations, one module per concern (DEVELOPMENT.md §11).

Each module exposes a `build_<tool_name>(deps: Deps) -> ToolFn` factory that closes over the
shared `Deps` and returns a plain async function with JSON-serialisable parameters, ready to
register on an `MCPServer` via `add_tool(fn, name=..., description=...)`.
"""

from __future__ import annotations

import functools
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from docintel_app.schemas import err_result

logger = logging.getLogger(__name__)

ToolFn = Callable[..., Awaitable[dict[str, Any]]]


def guarded(fn: ToolFn) -> ToolFn:
    """Catch any exception from `fn` and turn it into an `{ok: false, error}` envelope.

    Tools must never raise (DEVELOPMENT.md §9/§11). Uses `functools.wraps` so
    `inspect.signature()` — which `MCPServer.add_tool` uses to build the tool's JSON Schema —
    still sees `fn`'s real parameters and docstring, not `(*args, **kwargs)`.
    """

    # `Callable` doesn't guarantee `__name__` (some callables are plain objects), so read it
    # defensively even though every real tool passed in here is an `async def` function.
    name = getattr(fn, "__name__", "tool")

    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return await fn(*args, **kwargs)
        except Exception as exc:
            logger.exception("tool %s failed", name)
            return err_result(name, str(exc))

    return wrapper
