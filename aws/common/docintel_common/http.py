"""Retry-with-backoff wrapper for cross-cloud calls (DEVELOPMENT.md G8, §9 "Retry+timeout").

Kept to a single injectable-policy parameter (instead of the 5 loose keyword args a naive
`retrying(fn, attempts=3, backoff_s=0.5, jitter=True, retry_on=...)` signature would need) so it
stays within the project's 4-parameter function limit; see the final report for the empirical
ruff check (`PLR0913`) that confirmed the 5-arg form fails lint.
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S: float = 20.0


@dataclass(frozen=True)
class RetryPolicy:
    """Backoff schedule and the exception types worth retrying."""

    attempts: int = 3
    backoff_s: float = 0.5
    jitter: bool = True
    retry_on: tuple[type[BaseException], ...] = field(default=(Exception,))


_DEFAULT_POLICY = RetryPolicy()


def retrying[T](fn: Callable[[], T], policy: RetryPolicy = _DEFAULT_POLICY) -> T:
    """Call `fn()`, retrying on `policy.retry_on` with jittered exponential backoff.

    Re-raises the last exception unchanged once `policy.attempts` is exhausted.
    """
    for attempt in range(1, policy.attempts + 1):
        try:
            return fn()
        except policy.retry_on as exc:
            if attempt == policy.attempts:
                raise
            logger.warning(
                "retrying after failure (attempt %d/%d): %s", attempt, policy.attempts, exc
            )
            time.sleep(_backoff_seconds(attempt, policy))
    raise RuntimeError("retrying() misconfigured: policy.attempts must be >= 1")


def _backoff_seconds(attempt: int, policy: RetryPolicy) -> float:
    base = policy.backoff_s * (2 ** (attempt - 1))
    return base + random.uniform(0, base) if policy.jitter else base
