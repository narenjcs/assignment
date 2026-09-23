"""`docintel_common.http`: `retrying()`/`RetryPolicy` (DEVELOPMENT.md §9 retry+timeout pattern)."""

from __future__ import annotations

import pytest
from docintel_common.http import RetryPolicy, retrying


def test_retrying_returns_first_success_without_retrying() -> None:
    calls = {"n": 0}

    def fn() -> int:
        calls["n"] += 1
        return 42

    assert retrying(fn, RetryPolicy(attempts=3, backoff_s=0.0)) == 42
    assert calls["n"] == 1


def test_retrying_retries_then_succeeds() -> None:
    calls = {"n": 0}

    def fn() -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("transient")
        return "ok"

    policy = RetryPolicy(attempts=3, backoff_s=0.0, jitter=False, retry_on=(ConnectionError,))
    assert retrying(fn, policy) == "ok"
    assert calls["n"] == 3


def test_retrying_raises_last_exception_after_exhausting_attempts() -> None:
    calls = {"n": 0}

    def fn() -> None:
        calls["n"] += 1
        raise ValueError(f"failure {calls['n']}")

    with pytest.raises(ValueError, match="failure 2"):
        retrying(fn, RetryPolicy(attempts=2, backoff_s=0.0))
    assert calls["n"] == 2


def test_retrying_only_retries_matching_exception_types() -> None:
    def fn() -> None:
        raise TypeError("not retryable")

    policy = RetryPolicy(attempts=3, backoff_s=0.0, retry_on=(ConnectionError,))
    with pytest.raises(TypeError):
        retrying(fn, policy)
