"""Unity Catalog helpers: volume Files API I/O and parameterised SQL statement execution.

`persist_row` upserts by `job_id` via a single `MERGE INTO` so re-running the persist step is
idempotent (DEVELOPMENT.md G9) and a failed write can never leave the table without the previous
row (unlike a delete-then-insert, where a failure between the two statements loses it). All SQL
values are bound as `StatementParameterListItem`s — no user data is ever interpolated into
statement text.
"""

from __future__ import annotations

import json
import time
import urllib.request
from datetime import datetime
from io import BytesIO

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementParameterListItem, StatementResponse, StatementState

from docintel_app.schemas import DocumentRow, Entity

_SETUP_SQL = """\
CREATE TABLE IF NOT EXISTS {table} (
  job_id STRING,
  file_name STRING,
  source_s3_key STRING,
  volume_path STRING,
  page_count INT,
  word_count INT,
  char_count INT,
  extraction_method STRING,
  extracted_text STRING,
  summary STRING,
  key_points ARRAY<STRING>,
  entities ARRAY<STRUCT<name: STRING, type: STRING>>,
  topics ARRAY<STRING>,
  sentiment STRING,
  language STRING,
  model STRING,
  run_mode STRING,
  run_id STRING,
  processed_at TIMESTAMP
) USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')
"""

_COLUMNS = (
    "job_id",
    "file_name",
    "source_s3_key",
    "volume_path",
    "page_count",
    "word_count",
    "char_count",
    "extraction_method",
    "extracted_text",
    "summary",
    "key_points",
    "entities",
    "topics",
    "sentiment",
    "language",
    "model",
    "run_mode",
    "run_id",
    "processed_at",
)

_POLL_SECONDS = 1.0
_MAX_POLLS = 30


def download_pdf(url: str, timeout: int = 30) -> bytes:
    """Fetch PDF bytes from a presigned download URL (AWS S3), dependency-free via urllib."""
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def upload_to_volume(client: WorkspaceClient, volume_path: str, content: bytes) -> None:
    """Write `content` to `volume_path` (a `/Volumes/...` path), overwriting any existing file."""
    client.files.upload(volume_path, BytesIO(content), overwrite=True)


def download_from_volume(client: WorkspaceClient, volume_path: str) -> bytes:
    """Read a file back out of a UC volume."""
    response = client.files.download(volume_path)
    if response.contents is None:
        raise RuntimeError(f"empty download response for {volume_path}")
    return response.contents.read()


def ensure_table(client: WorkspaceClient, warehouse_id: str, table: str) -> None:
    """Idempotently create `document_results` if it doesn't exist yet (mirrors sql/setup.sql)."""
    run_statement(client, warehouse_id, _SETUP_SQL.format(table=table))


def run_statement(
    client: WorkspaceClient,
    warehouse_id: str,
    statement: str,
    parameters: list[StatementParameterListItem] | None = None,
) -> list[list[str]]:
    """Execute one SQL statement to completion and return its rows (empty for DDL/DML)."""
    response = client.statement_execution.execute_statement(
        statement=statement,
        warehouse_id=warehouse_id,
        parameters=parameters,
        wait_timeout="30s",
    )
    response = _await_terminal(client, response)
    state = response.status.state if response.status else None
    if state != StatementState.SUCCEEDED:
        raise RuntimeError(f"statement failed in state {state}: {_error_message(response)}")
    if response.result and response.result.data_array:
        return response.result.data_array
    return []


def _await_terminal(client: WorkspaceClient, response: StatementResponse) -> StatementResponse:
    """Poll `get_statement` until the statement leaves PENDING/RUNNING or polling is exhausted."""
    pending = {StatementState.PENDING, StatementState.RUNNING}
    attempts = 0
    while response.status and response.status.state in pending and attempts < _MAX_POLLS:
        if response.statement_id is None:
            raise RuntimeError("statement response is missing statement_id while polling")
        time.sleep(_POLL_SECONDS)
        response = client.statement_execution.get_statement(response.statement_id)
        attempts += 1
    return response


def _error_message(response: StatementResponse) -> str:
    """Best-effort human-readable error from a failed `StatementResponse`."""
    if response.status and response.status.error:
        return response.status.error.message or "unknown error"
    return "unknown error"


# One source-row expression per `_COLUMNS` entry, used to build `persist_row`'s MERGE INTO
# source subquery. `key_points`/`entities`/`topics` decode from JSON-encoded parameters (an
# array/struct value can't be bound directly as a `StatementParameterListItem`); `processed_at`
# is set from the server clock, not a bound parameter.
_MERGE_SOURCE_EXPRS = {
    "job_id": ":job_id",
    "file_name": ":file_name",
    "source_s3_key": ":source_s3_key",
    "volume_path": ":volume_path",
    "page_count": ":page_count",
    "word_count": ":word_count",
    "char_count": ":char_count",
    "extraction_method": ":extraction_method",
    "extracted_text": ":extracted_text",
    "summary": ":summary",
    "key_points": "from_json(:key_points_json, 'array<string>')",
    "entities": "from_json(:entities_json, 'array<struct<name:string,type:string>>')",
    "topics": "from_json(:topics_json, 'array<string>')",
    "sentiment": ":sentiment",
    "language": ":language",
    "model": ":model",
    "run_mode": ":run_mode",
    "run_id": ":run_id",
    "processed_at": "current_timestamp()",
}


def persist_row(client: WorkspaceClient, warehouse_id: str, table: str, row: DocumentRow) -> None:
    """Upsert `row` into `table`, keyed by job_id, via one `MERGE INTO` (idempotent per G9;
    unlike delete-then-insert, a failed write can never lose the previous row).
    """
    select_exprs = ", ".join(f"{expr} AS {col}" for col, expr in _MERGE_SOURCE_EXPRS.items())
    merge_sql = (
        f"MERGE INTO {table} AS t USING (SELECT {select_exprs}) AS s "
        "ON t.job_id = s.job_id "
        "WHEN MATCHED THEN UPDATE SET * "
        "WHEN NOT MATCHED THEN INSERT *"
    )
    run_statement(client, warehouse_id, merge_sql, _row_params(row))


def fetch_row(
    client: WorkspaceClient, warehouse_id: str, table: str, job_id: str
) -> DocumentRow | None:
    """Read the most recently persisted row for `job_id`, or None if none exists yet."""
    select_sql = (
        f"SELECT {', '.join(_COLUMNS)} FROM {table} WHERE job_id = :job_id "
        "ORDER BY processed_at DESC LIMIT 1"
    )
    param = [StatementParameterListItem(name="job_id", value=job_id, type="STRING")]
    rows = run_statement(client, warehouse_id, select_sql, param)
    return _row_from_values(rows[0]) if rows else None


def _row_params(row: DocumentRow) -> list[StatementParameterListItem]:
    """Bind a `DocumentRow` to `StatementParameterListItem`s for the INSERT in `persist_row`."""

    def p(name: str, value: str | None, sql_type: str = "STRING") -> StatementParameterListItem:
        return StatementParameterListItem(name=name, value=value, type=sql_type)

    return [
        p("job_id", row.job_id),
        p("file_name", row.file_name),
        p("source_s3_key", row.source_s3_key),
        p("volume_path", row.volume_path),
        p("page_count", str(row.page_count) if row.page_count is not None else None, "INT"),
        p("word_count", str(row.word_count) if row.word_count is not None else None, "INT"),
        p("char_count", str(row.char_count) if row.char_count is not None else None, "INT"),
        p("extraction_method", row.extraction_method),
        p("extracted_text", row.extracted_text),
        p("summary", row.summary),
        p("key_points_json", json.dumps(row.key_points)),
        p("entities_json", json.dumps([e.model_dump() for e in row.entities])),
        p("topics_json", json.dumps(row.topics)),
        p("sentiment", row.sentiment),
        p("language", row.language),
        p("model", row.model),
        p("run_mode", row.run_mode),
        p("run_id", row.run_id),
    ]


def _row_from_values(values: list[str]) -> DocumentRow:
    """Decode one `data_array` row (column order = `_COLUMNS`) back into a `DocumentRow`."""
    raw = dict(zip(_COLUMNS, values, strict=False))
    entities = [Entity(**e) for e in json.loads(raw["entities"])] if raw.get("entities") else []
    processed_at = datetime.fromisoformat(raw["processed_at"]) if raw.get("processed_at") else None
    return DocumentRow(
        job_id=raw["job_id"],
        file_name=raw.get("file_name"),
        source_s3_key=raw.get("source_s3_key"),
        volume_path=raw.get("volume_path"),
        page_count=int(raw["page_count"]) if raw.get("page_count") else None,
        word_count=int(raw["word_count"]) if raw.get("word_count") else None,
        char_count=int(raw["char_count"]) if raw.get("char_count") else None,
        extraction_method=raw.get("extraction_method"),
        extracted_text=raw.get("extracted_text"),
        summary=raw.get("summary"),
        key_points=json.loads(raw["key_points"]) if raw.get("key_points") else [],
        entities=entities,
        topics=json.loads(raw["topics"]) if raw.get("topics") else [],
        sentiment=raw.get("sentiment"),
        language=raw.get("language"),
        model=raw.get("model"),
        run_mode="async" if raw.get("run_mode") == "async" else "sync",
        run_id=raw.get("run_id"),
        processed_at=processed_at,
    )
