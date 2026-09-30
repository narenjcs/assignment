"""Structured, correlation-safe logs for the Databricks App and PDF job.

Do not add document text, download URLs, bearer tokens, client secrets, or model prompts to fields.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any


def log_event(
    logger: logging.Logger, event: str, *, level: int = logging.INFO, **fields: Any
) -> None:
    """Write one JSON log record suitable for Databricks log search and job-run correlation."""
    logger.log(
        level,
        json.dumps(
            {"level": logging.getLevelName(level).lower(), "event": event, **fields},
            default=str,
            sort_keys=True,
        ),
    )


def elapsed_ms(started_at: float) -> int:
    """Return elapsed monotonic time in milliseconds for a log field."""
    return round((time.perf_counter() - started_at) * 1000)
