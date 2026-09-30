"""Tests for correlation-safe Databricks JSON logging."""

from __future__ import annotations

import json
import logging

from docintel_app.observability import elapsed_ms, log_event


def test_log_event_emits_json_with_event_and_correlation_fields(caplog) -> None:
    logger = logging.getLogger("test-observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(logger, "pdf_agent_started", job_id="job-1", run_mode="async")

    record = json.loads(caplog.messages[0])
    assert record == {
        "level": "info",
        "event": "pdf_agent_started",
        "job_id": "job-1",
        "run_mode": "async",
    }
    assert caplog.records[0].levelno == logging.INFO


def test_log_event_honours_level(caplog) -> None:
    logger = logging.getLogger("test-observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(logger, "pdf_agent_failed", level=logging.ERROR, job_id="job-1")

    assert caplog.records[0].levelno == logging.ERROR


def test_elapsed_ms_is_nonnegative() -> None:
    assert elapsed_ms(0.0) >= 0
