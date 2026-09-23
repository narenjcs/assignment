"""Server-sent-event helpers shared by the orchestrator and the API Lambda contract."""

from __future__ import annotations

import json
from typing import Any


def event(type_: str, **fields: Any) -> dict:
    return {"type": type_, **fields}


def frame(payload: dict) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"
