"""Unit tests for `tools.ingest`: `file_name` sanitisation (item 7) — `os.path.basename` strips
any directory component (defence against a crafted `file_name` writing outside the inbox
prefix), and an empty/whitespace-only result is rejected rather than producing a malformed
`{volume}/{job_id}_` path.
"""

from __future__ import annotations

import base64

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


@pytest.mark.anyio
async def test_ingest_pdf_prefers_gateway_content_over_presigned_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _url_must_not_be_used(url: str, timeout: int = 30) -> bytes:
        raise AssertionError("presigned URL used although the gateway returned content")

    monkeypatch.setattr(ingest_mod.uc, "download_pdf", _url_must_not_be_used)
    encoded = base64.b64encode(b"%PDF-gateway").decode()
    deps = make_deps(
        aws_responses={"get_document_content": {"ok": True, "data": {"contentBase64": encoded}}}
    )
    tool = ingest_mod.build_ingest_pdf(deps)

    result = await tool("job-4", "https://s3.example/d.pdf", "d.pdf")

    assert result["ok"] is True
    assert result["data"]["byte_count"] == len(b"%PDF-gateway")
    assert deps.aws.calls == [("get_document_content", {"job_id": "job-4"})]


@pytest.mark.anyio
async def test_ingest_pdf_falls_back_to_url_when_gateway_reports_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ingest_mod.uc, "download_pdf", lambda url, timeout=30: b"from-url")
    deps = make_deps(aws_responses={"get_document_content": {"ok": False, "error": {"code": "X"}}})
    tool = ingest_mod.build_ingest_pdf(deps)

    result = await tool("job-5", "https://s3.example/e.pdf", "e.pdf")

    assert result["ok"] is True
    assert result["data"]["byte_count"] == len(b"from-url")


@pytest.mark.anyio
async def test_ingest_pdf_reports_both_errors_when_gateway_and_url_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _reset(url: str, timeout: int = 30) -> bytes:
        raise ConnectionResetError(104, "Connection reset by peer")

    monkeypatch.setattr(ingest_mod.uc, "download_pdf", _reset)
    deps = make_deps(aws_responses={"get_document_content": {"ok": False, "error": {"code": "X"}}})
    tool = ingest_mod.build_ingest_pdf(deps)

    result = await tool("job-6", "https://s3.example/f.pdf", "f.pdf")

    assert result["ok"] is False
    assert "gateway:" in result["error"]["message"]
    assert "presigned url:" in result["error"]["message"]
