"""Tests for `docintel_common.observability`: one JSON record per event, level honoured."""

from __future__ import annotations

import json
import logging

from docintel_common.observability import elapsed_ms, log_event


def test_log_event_emits_json_at_requested_level(caplog) -> None:
    logger = logging.getLogger("test-common-observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(logger, "docx_agent_failed", level=logging.ERROR, job_id="job-1")

    assert caplog.records[0].levelno == logging.ERROR
    assert json.loads(caplog.messages[0]) == {
        "level": "error",
        "event": "docx_agent_failed",
        "job_id": "job-1",
    }


def test_elapsed_ms_is_nonnegative() -> None:
    assert elapsed_ms(0.0) >= 0
