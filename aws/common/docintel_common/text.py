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
