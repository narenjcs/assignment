"""Small text utilities shared by both agents."""

from __future__ import annotations

MAX_JOB_MESSAGE_LENGTH = 1900
"""Kept under the Lambda `update_job_status`/`save_job_result` tool schema's 2000-char cap
(`aws/lambdas/src/mcp-tools/tools/jobs.ts`'s `MAX_MESSAGE_LENGTH`), leaving headroom for any
prefix a caller adds before sending the message on.
"""

_TRUNCATION_MARKER = "…"


def truncate_message(message: str, limit: int = MAX_JOB_MESSAGE_LENGTH) -> str:
    """Truncate `message` to at most `limit` characters, marking the cut if one happened.

    Guards against embedding a full pydantic `ValidationError` (which can run to several KB of
    per-field detail) in a job-status `message`, where the Lambda's Zod schema caps at 2000
    chars and would otherwise reject the whole `update_job_status`/`save_job_result` call.
    """
    if len(message) <= limit:
        return message
    return message[: limit - len(_TRUNCATION_MARKER)].rstrip() + _TRUNCATION_MARKER


def root_cause(exc: BaseException) -> BaseException:
    """The innermost exception behind `exc`, through exception groups and `raise ... from`.

    The MCP client runs on anyio task groups, so a plain connection failure reaches callers as
    `MCPClientInitializationError: ... unhandled errors in a TaskGroup (1 sub-exception)`, which
    says nothing about what actually broke. Follows the first sub-exception of each group, then
    `__cause__`/`__context__`, with a visited set so a cyclic chain can't loop forever.
    """
    seen: set[int] = set()
    current = exc
    while id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, BaseExceptionGroup) and current.exceptions:
            current = current.exceptions[0]
        elif current.__cause__ is not None:
            current = current.__cause__
        elif current.__context__ is not None and not current.__suppress_context__:
            current = current.__context__
        else:
            break
    return current
