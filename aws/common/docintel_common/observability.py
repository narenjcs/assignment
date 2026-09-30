"""Structured, correlation-safe logs for AgentCore applications.

Do not add document text, model prompts/tokens, presigned URLs, bearer tokens, or secrets.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any


def log_event(
    logger: logging.Logger, event: str, *, level: int = logging.INFO, **fields: Any
) -> None:
    """Write one JSON record that CloudWatch Logs Insights can query by job ID."""
    logger.log(
        level,
        json.dumps(
            {"level": logging.getLevelName(level).lower(), "event": event, **fields},
            default=str,
            sort_keys=True,
        ),
    )


def elapsed_ms(started_at: float) -> int:
    """Return monotonic elapsed time in milliseconds for log fields."""
    return round((time.perf_counter() - started_at) * 1000)
