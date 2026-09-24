"""Entry point for the async `docintel_pdf_agent` Databricks job (PLAN.md §2.2 async path).

`spark_python_task` positional args (see `../resources/jobs.yml`): job_id, download_url,
file_name, source_s3_key, warehouse_id, llm_endpoint, catalog, schema, secret_scope, run_id.
AWS creds are read from the Databricks secret scope at run time, never passed as job parameters
(DEVELOPMENT.md G6). `run_id` is `{{job.run_id}}` (a job parameter default), threaded through so
`agent._build_result` records it as `databricksRunId`.

The job's pip environment (`resources/jobs.yml`) has no `fastapi`/`uvicorn`, so this file must
never import `docintel_app.server` (it imports `fastapi` at module level). `sys.path` is
bootstrapped to the sibling `app/src` directory instead — DAB sync preserves this repo's
`databricks/jobs/` + `databricks/app/src/` relative layout in the workspace — so `docintel_app`
is importable without an editable install, then only `agent`/`config`/`deps` are pulled from it
(`deps.build_deps` has no `fastapi` import in its chain either).

`databricks.sdk.runtime` (`dbutils`) is imported lazily inside `_secret`: it eagerly
authenticates on import and only succeeds inside a real job/cluster context, so importing it at
module level would break importing this file anywhere else (e.g. tests).
"""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import Coroutine
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def _app_src() -> Path:
    """Locate the bundled `app/src` directory so `docintel_app` is importable.

    Serverless `spark_python_task` executes this file without defining `__file__`, so a bare
    `Path(__file__)` raises `NameError: name '__file__' is not defined` before the job does any
    work. Fall back to the working directory and walk upwards looking for the package.
    """
    try:
        start = Path(__file__).resolve().parent.parent
    except NameError:  # serverless task execution
        start = Path.cwd()
    for candidate in (start, *start.parents):
        src = candidate / "app" / "src"
        if (src / "docintel_app").is_dir():
            return src
    return start / "app" / "src"


sys.path.insert(0, str(_app_src()))

from docintel_app import agent  # noqa: E402 — import must follow the sys.path bootstrap above
from docintel_app.config import Settings  # noqa: E402 — same
from docintel_app.deps import build_deps  # noqa: E402 — same

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_ARG_COUNT = 11  # argv[0] (script path) + 10 job parameters


def _secret(scope: str, key: str) -> str:
    """Read one secret via `dbutils.secrets.get` (lazy import; see module docstring)."""
    from databricks.sdk.runtime import dbutils  # noqa: PLC0415 — see module docstring

    return dbutils.secrets.get(scope=scope, key=key)


def _build_settings(config: dict[str, str], secret_scope: str) -> Settings:
    """Build `Settings` from job parameters plus AWS creds read from the secret scope."""
    return Settings(
        warehouse_id=config["warehouse_id"],
        llm_endpoint=config["llm_endpoint"],
        catalog=config["catalog"],
        schema_name=config["schema_name"],
        aws_gateway_url=_secret(secret_scope, "aws_gateway_url"),
        aws_mcp_token_url=_secret(secret_scope, "aws_mcp_token_url"),
        aws_mcp_client_id=_secret(secret_scope, "aws_mcp_client_id"),
        aws_mcp_client_secret=_secret(secret_scope, "aws_mcp_client_secret"),
        aws_mcp_scope=_secret(secret_scope, "aws_mcp_scope"),
    )


def _run_async(coro: Coroutine[object, object, dict]) -> dict:
    """Run `coro` to completion whether or not an event loop is already running.

    Serverless `spark_python_task` executes this script inside an existing event loop, where
    `asyncio.run` raises "asyncio.run() cannot be called from a running event loop". In that case
    run it on a worker thread that owns its own loop.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def main(argv: list[str]) -> int:
    """Parse job parameters, build real `Deps`, and run the PDF agent pipeline once."""
    if len(argv) < _ARG_COUNT:
        logger.error("expected %d args, got %d: %r", _ARG_COUNT, len(argv), argv)
        return 1
    job_id, download_url, file_name, source_s3_key = argv[1:5]
    warehouse_id, llm_endpoint, catalog, schema, secret_scope, run_id = argv[5:11]
    config = {
        "warehouse_id": warehouse_id,
        "llm_endpoint": llm_endpoint,
        "catalog": catalog,
        "schema_name": schema,
    }
    deps = build_deps(_build_settings(config, secret_scope))
    job = {
        "job_id": job_id,
        "download_url": download_url,
        "file_name": file_name,
        "source_s3_key": source_s3_key or None,
        "run_mode": "async",
        "run_id": run_id or None,
    }
    result = _run_async(agent.run(deps, job))
    logger.info("pdf agent job %s finished: %s", job_id, result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
