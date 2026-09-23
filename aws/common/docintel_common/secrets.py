"""Secrets Manager reader with a small in-process cache."""

from __future__ import annotations

import json
import time

import boto3

from . import config

_cache: dict[str, tuple[float, dict]] = {}
_TTL = 300.0


def get_secret_json(arn: str, *, region: str | None = None) -> dict:
    hit = _cache.get(arn)
    if hit and hit[0] > time.time():
        return hit[1]
    client = boto3.client("secretsmanager", region_name=region or config.get_settings().region)
    raw = client.get_secret_value(SecretId=arn)["SecretString"]
    data = json.loads(raw)
    _cache[arn] = (time.time() + _TTL, data)
    return data
