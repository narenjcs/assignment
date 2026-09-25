"""Unit tests for `docintel_common.text.root_cause`: the readable cause behind the MCP client's
anyio exception groups (a STOPPED Databricks App showed only "unhandled errors in a TaskGroup")."""

from __future__ import annotations

from docintel_common.text import root_cause


def _raise_wrapped() -> BaseException:
    try:
        try:
            raise ExceptionGroup("unhandled errors in a TaskGroup", [ConnectionRefusedError(111)])
        except ExceptionGroup as group:
            raise RuntimeError("the client initialization failed") from group
    except RuntimeError as exc:
        return exc


def test_root_cause_digs_through_cause_and_exception_group() -> None:
    cause = root_cause(_raise_wrapped())
    assert isinstance(cause, ConnectionRefusedError)


def test_root_cause_follows_implicit_context() -> None:
    try:
        try:
            raise TimeoutError("read timed out")
        except TimeoutError:
            raise ValueError("while handling")  # noqa: B904 -- implicit __context__ is the point
    except ValueError as exc:
        assert isinstance(root_cause(exc), TimeoutError)


def test_root_cause_of_a_plain_exception_is_itself() -> None:
    exc = OSError("boom")
    assert root_cause(exc) is exc


def test_root_cause_terminates_on_a_cyclic_chain() -> None:
    first, second = RuntimeError("a"), RuntimeError("b")
    first.__cause__, second.__cause__ = second, first
    assert root_cause(first) in (first, second)
