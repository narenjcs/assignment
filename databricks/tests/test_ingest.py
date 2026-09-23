"""Unit tests for `tools.ingest`: `file_name` sanitisation (item 7) — `os.path.basename` strips
any directory component (defence against a crafted `file_name` writing outside the inbox
prefix), and an empty/whitespace-only result is rejected rather than producing a malformed
`{volume}/{job_id}_` path.
"""

from __future__ import annotations

import pytest
from docintel_app.tools import ingest as ingest_mod
from fakes import make_deps


@pytest.mark.anyio
async def test_ingest_pdf_sanitises_path_traversal_in_file_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"pdf-bytes")
    deps = make_deps()
    tool = ingest_mod.build_ingest_pdf(deps)

    result = await tool("job-1", "https://s3.example/a.pdf", "../../etc/passwd")

    assert result["ok"] is True
    assert result["data"]["volume_path"] == f"{deps.settings.volume_path}/job-1_passwd"


@pytest.mark.anyio
async def test_ingest_pdf_rejects_empty_file_name(monkeypatch: pytest.MonkeyPatch) -> None:
    called = False

    def _fail_if_called(url: str, timeout: int = 30) -> bytes:
        nonlocal called
        called = True
        return b""

    monkeypatch.setattr(ingest_mod.uc, "download_pdf", _fail_if_called)
    deps = make_deps()
    tool = ingest_mod.build_ingest_pdf(deps)

    result = await tool("job-2", "https://s3.example/b.pdf", "  ../  ")

    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_file_name"
    assert called is False


@pytest.mark.anyio
async def test_ingest_pdf_strips_surrounding_whitespace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"pdf-bytes")
    deps = make_deps()
    tool = ingest_mod.build_ingest_pdf(deps)

    result = await tool("job-3", "https://s3.example/c.pdf", "  report.pdf  ")

    assert result["ok"] is True
    assert result["data"]["volume_path"] == f"{deps.settings.volume_path}/job-3_report.pdf"
