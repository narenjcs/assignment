# DocIntel – Development Standards

This document is binding for every contributor, human or AI (Claude Opus, Sonnet, Fable, or anything else). It exists so that code quality does not depend on who or what writes the code. If a rule here conflicts with your habit, the rule wins. If a rule blocks a task, raise it in `docs/TASKS.md` instead of silently breaking it.

**Read this file completely before writing or editing any code. Run `make check` before calling any task done.**

---

## 1. Ground rules (non-negotiable)

| # | Rule | Enforced by |
|---|---|---|
| G1 | A source file is **≤ 300 lines** (TS, TSX, Python). Test files ≤ 400. | `scripts/lint-file-length.sh`, ESLint `max-lines` |
| G2 | A function is **≤ 50 lines**, cyclomatic complexity **≤ 10**, **≤ 4 parameters** (use an options object / dataclass beyond that). | ESLint `max-lines-per-function`, `complexity`, `max-params`; Ruff `C901`, `PLR0913`, `PLR0915` |
| G3 | Line length **100**. | Prettier `printWidth`, Ruff `line-length` |
| G4 | **No `any`** in TypeScript, **no untyped public functions** in Python. `// eslint-disable` and `# noqa` / `# type: ignore` need a reason on the same line. | ESLint `no-explicit-any`, Ruff `ANN`, `ty` |
| G5 | Zero lint warnings. Zero format diffs. Zero failing tests. `make check` is the gate. | `make check` |
| G6 | **No secrets, hosts, ARNs, or account ids in code.** Everything comes from env / CDK context / Secrets Manager / Databricks secrets. | Code review, `.env.example` |
| G7 | One responsibility per module. Handlers are thin (parse → call service → format). Business logic lives in `lib/` (TS) or a package module (Python) and is unit-tested without the network. | Folder structure §2 |
| G8 | Every network call has an explicit **timeout**; cross-cloud calls (AWS↔Databricks) have **retry with backoff** (max 3, jittered). | Helpers in `lib/http.ts`, `docintel_common/http.py` |
| G9 | Every job mutation appends a trace event (`source`, `agent`, `tool`, `message`). No silent state changes. | `JobStore` API |
| G10 | No `TODO` without a task id (`TODO(T4.2): …`). No commented-out code. No dead code (`vulture`, ESLint `no-unused-vars`). | Ruff, ESLint, review |

---

## 2. Repository layout (target state)

```
assignment/
├── CLAUDE.md                     # points every AI agent at this file
├── Makefile                      # single entry point: build / lint / test / check / deploy
├── package.json                  # npm workspaces: aws/infra, aws/lambdas, frontend
├── pyproject.toml                # root Ruff + ty config (applies to all Python)
├── eslint.config.js  .prettierrc  .editorconfig
├── docs/                         # PLAN, ROADMAP, TASKS, DEVELOPMENT, DEMO
├── samples/                      # make_samples.py + generated demo docs
├── scripts/                      # bash/python ops scripts, each ≤ 150 lines, `set -euo pipefail`
├── frontend/                     # Vite + React 19 + TS (strict) + Tailwind 4
│   └── src/
│       ├── app/                  # App.tsx, routes, providers
│       ├── components/           # dumb, reusable UI (Badge, Card, Stepper, Dropzone) – one per file
│       ├── features/             # upload/, jobs/, chat/ – feature = components + hooks + api calls
│       ├── lib/                  # api client, sse parser, config loader, formatters (pure, tested)
│       └── types/                # shared TS types (Job, JobEvent, JobResult, SseEvent)
├── aws/
│   ├── infra/                    # CDK v2 (TS)
│   │   ├── bin/docintel.ts
│   │   └── lib/
│   │       ├── docintel-stack.ts # composition only, ≤ 150 lines
│   │       └── constructs/       # storage.ts, auth.ts, gateway.ts, runtimes.ts, api.ts, web.ts
│   ├── lambdas/                  # Node 22 TS, bundled by CDK NodejsFunction (esbuild)
│   │   ├── src/
│   │   │   ├── api/              # handler.ts (router only) + routes/{uploads,jobs,chat}.ts
│   │   │   ├── s3-trigger/handler.ts
│   │   │   ├── mcp-tools/        # handler.ts (dispatch only) + tools/{jobs,docx,urls}.ts
│   │   │   └── lib/              # jobs.ts, s3.ts, agentcore.ts, sse.ts, http.ts, config.ts, errors.ts, log.ts
│   │   ├── tools.json            # Gateway tool schema (single source of truth, validated in tests)
│   │   └── tests/                # vitest, mocked AWS SDK (aws-sdk-client-mock)
│   ├── agents/                   # Python 3.12, AgentCore Runtime (zip)
│   │   ├── orchestrator/         # main.py (entrypoint only) + workflow.py, tools.py, prompts.py, events.py
│   │   ├── docx_agent/           # main.py + enrich.py, prompts.py, schemas.py
│   │   ├── tests/                # pytest, no network
│   │   └── build.sh
│   └── common/docintel_common/   # auth.py (OAuth M2M), http.py (timeouts/retry), sse.py, config.py
└── databricks/
    ├── databricks.yml  resources/*.yml
    ├── app/                      # Databricks App
    │   ├── app.yaml  pyproject.toml  requirements.txt
    │   └── src/docintel_app/     # server.py (FastAPI/MCP mount) tools/{ingest,extract,enrich,persist,runs}.py
    │                             # agent.py (tool loop) llm.py uc.py aws_mcp.py config.py schemas.py
    ├── jobs/pdf_agent_job.py     # thin entry, imports docintel_app
    ├── sql/setup.sql
    └── tests/
```

Rules for the layout:
- **Do not create new top-level folders.** If something does not fit, ask in TASKS.md.
- `lib/` and `docintel_common/` modules are **pure** where possible (inputs → outputs), with clients injected so tests never touch the network.
- Shared types are defined once (`frontend/src/types`, `aws/lambdas/src/lib/types.ts`, Python `schemas.py` with pydantic) and mirrored deliberately; the SSE and Job JSON contracts in `docs/PLAN.md` §2.4–2.6 are the source of truth.

---

## 3. TypeScript standards (Lambdas, CDK, frontend)

- `"strict": true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`. ESM only (`"type": "module"`).
  - **Sanctioned exception:** `aws/infra` sets `exactOptionalPropertyTypes: false`. aws-cdk-lib's own declarations are not clean under that flag (concrete `Bucket`/`Secret` are not assignable to `IBucket`/`ISecret`), so the alternative is casts at every construct boundary. Every other strict flag still applies, and no other workspace may relax it.
- Validate all external input at the boundary with **zod** (HTTP bodies, S3 event keys, Gateway tool args, SSE frames). Never trust `JSON.parse` output without a schema.
- Named exports only, except React components and the CDK stack class.
- Files: `kebab-case.ts` for modules; React components `PascalCase.tsx`; React hooks `useThing.ts` (camelCase, one hook per file, next to their feature); types/interfaces: `PascalCase`; functions/vars: `camelCase`; constants: `UPPER_SNAKE`.
- AWS SDK v3 clients are created once per module at top level and passed into functions that need them (`deps` parameter) so tests can substitute `aws-sdk-client-mock`.
- Errors: throw `DocIntelError` subclasses (`NotFoundError`, `ValidationError`, `UpstreamError`) from `lib/errors.ts`; the API router maps them to HTTP status codes in one place.
- Logging: `lib/log.ts` emits one JSON line per event with `jobId` when known. No `console.log` outside `lib/log.ts`.
- React: function components only, hooks in `features/*/useThing.ts`, no business logic in JSX, one component per file, props typed, Tailwind classes only (no inline style objects except dynamic values).
- CDK: one construct per file under `lib/constructs/`, props interfaces exported, no hard-coded names except via a `naming.ts` helper; every IAM grant uses the L2 `grant*` methods; no `*` resources.

Workspace `lint` scripts run `eslint`, `prettier --check`, and `tsc --noEmit` — Prettier is part of the gate, not optional. ESLint (flat config) rules that implement §1: `max-lines: 300` (150 for `.tsx`), `react-hooks` + `jsx-a11y` recommended on `.tsx`, `max-lines-per-function: 50`, `complexity: 10`, `max-params: 4`, `@typescript-eslint/no-explicit-any: error`, `@typescript-eslint/explicit-module-boundary-types: error`, `no-console: error` (allowed only in `lib/log.ts`), `import/order`, `unused-imports/no-unused-imports`. Prettier: `printWidth 100`, `singleQuote true`, `trailingComma all`.

---

## 4. Python standards (AgentCore agents, Databricks app/job, scripts)

- Python **3.12**, `from __future__ import annotations`, full type hints on every public function, **pydantic v2** models for all structured data (tool inputs/outputs, LLM JSON, job results).
- Package layout: one concern per module (`workflow.py`, `tools.py`, `prompts.py`, `schemas.py`, `events.py`); `main.py` contains only the AgentCore/FastAPI wiring (≤ 80 lines).
- No bare `except:`; catch specific exceptions; re-raise with context (`raise UpstreamError(...) from exc`).
- No print in library code; use `logging` with a JSON formatter configured once in `main.py`. Include `job_id` in every log record via `extra=`.
- Prompts live in `prompts.py` as constants; never inline multi-line prompts in logic.
- LLM output that must be structured is parsed with pydantic (`Model.model_validate_json`) and retried once with the validation error fed back; never regex-scrape JSON.
- Dependencies pinned in `requirements.txt` (exact versions). Installed with `uv`. `mcp` is 2.x (`MCPServer`, `Client`); Strands 1.5x; bedrock-agentcore 1.2x — check the installed API before using a method.

Ruff config (root `pyproject.toml`): `line-length = 100`, `select = ["E","F","W","I","N","UP","B","C4","C90","ANN","SIM","PL","RUF","T20"]`, `mccabe.max-complexity = 10`, `pylint.max-args = 4`, `pylint.max-statements = 50`, `T20` bans print. Type check with `ty check` (the `python-analyzer` MCP tools `ruff-check`, `ruff-format`, `ty-check`, `vulture-scan` are available to AI agents and run the same config).

---

## 5. Testing standards

| Layer | Tool | Minimum |
|---|---|---|
| `aws/lambdas/src/lib/*`, `mcp-tools/tools/*`, `api/routes/*` | vitest + `aws-sdk-client-mock` | every exported function; every tool has a happy path + one error path |
| `aws/infra` | vitest + CDK assertions (`Template.fromStack`) | resource counts, IAM has no `*` actions, Function URL is streaming, Gateway uses JWT |
| `aws/agents/*` | pytest + `moto`-free fakes (inject clients) | workflow routing (docx→AWS, pdf→Databricks), event mapping, schema parsing |
| `databricks/app` | pytest | every tool with fake UC/LLM clients; `ai_parse_document` fallback logic |
| `frontend/src/lib` | vitest | SSE parser, api client error mapping, formatters |
| End-to-end | `scripts/e2e.sh` | 4 scenarios (docx/pdf × sync/async) against a deployed stack |

Rules: unit tests never hit the network or the real cloud; test names describe behaviour (`returns_404_when_job_missing`); fixtures in `tests/fixtures/`; coverage target **70 %** on `lib/`, `tools/`, `docintel_app/` (reported by `make test`, not yet blocking).

---

## 6. Quality gates and commands

```
make venv        # one-time: ./.venv (Python 3.12) with pinned tooling from requirements-dev.txt
make lint        # eslint + prettier --check + tsc --noEmit (all workspaces); ruff check + ruff format --check + ty check; file-length check
make format      # prettier --write; ruff format; ruff check --fix
make test        # vitest (lambdas, infra, frontend) + pytest (agents, databricks)
make check       # lint + test  ← required before a task is marked [x]
make hooks       # installs .git/hooks/pre-commit that runs `make lint`
```

Definition of Done for any task in `docs/TASKS.md`:
1. Code follows §1–§4; new modules have tests per §5.
2. `make check` passes locally (paste the summary line in the task note if AI-authored).
3. Docs updated if behaviour or contracts changed (`PLAN.md` §2.4–2.7, `.env.example`).
4. `TASKS.md` box ticked with a one-line note of what was built and any follow-ups (with ids).

---

## 7. Working agreement for AI coding agents

1. Read `CLAUDE.md`, this file, and the task's row in `docs/TASKS.md` before touching code. Do one task at a time.
2. Before using a library API, verify it against the **installed** version (`python -c "import x; help(x.Y)"`, `npm view`, or reading `node_modules`). Do not rely on memory for `mcp`, `strands`, `bedrock-agentcore`, `aws-cdk-lib`.
3. Prefer extending an existing module over creating a new file. If a file would exceed 300 lines, split by responsibility, not by line count.
4. Keep contracts stable: changing a JSON shape means updating `PLAN.md`, the TS type, the Python schema, and the tests in the same change.
5. Never weaken a lint rule to make code pass. If a rule is wrong for a case, note it in TASKS.md and ask.
6. Do not deploy, delete cloud resources, push to a remote, or spend money without an explicit instruction. Local `make check` is always allowed.
7. When done, report: files touched, `make check` result, anything skipped and why.

---

## 7.1 Two-model workflow (decided 2026-09-23)

- **Implementer = Claude Sonnet** (subagent per task, scoped to one directory). It reads `CLAUDE.md`, this file, and its task rows, writes code + tests, runs `make check`, and reports files touched and the gate result. It never edits `docs/TASKS.md`, root config, or another task's directory, and never deploys.
- **Reviewer = Claude Fable** (this session). For every implementer report it: (1) re-runs `make check`; (2) reviews the diff against §1–§12 with `/code-review`; (3) checks contracts against `PLAN.md` §2.4–2.7; (4) either sends a fix list back to a Sonnet subagent or accepts and ticks the task in `TASKS.md` with a note.
- **Acceptance bar**: gate green, no rule waivers, tests present per §5, no scope creep, no unverified library APIs (the implementer must cite the installed signature it used).
- **Escalation**: anything needing money, cloud mutation, or a design change goes to Naren, not to a subagent.

## 8. Git conventions

- Branch per phase (`p2-aws-core`, `p5-databricks`); small commits; message format `T2.3: add DynamoDB jobs table + GSI` (task id first).
- Commit only when Naren asks. Never commit `.env`, `cdk-outputs.json`, generated zips, or sample outputs.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` when AI-authored.

---

## 9. Design patterns (use these, and only these, unless TASKS.md says otherwise)

| Pattern | Where | How it looks here |
|---|---|---|
| **Handler → Service → Adapter** (hexagonal-lite) | every Lambda, the Databricks app, both agents | `handler.ts` parses/validates and returns; `routes/*.ts` or `tools/*.ts` hold the logic; `lib/*.ts` adapters wrap AWS/Databricks SDKs. Same in Python: `main.py` → `workflow.py`/`tools/*.py` → `uc.py`/`llm.py`/`aws_mcp.py`. |
| **Dependency injection by parameter** | all adapters | `createJobStore({ ddb, tableName })`, `JobStore(table=…)`; functions receive a `deps` object, never import a global client inside logic. Tests pass fakes. |
| **Registry / command dispatch** | MCP tools Lambda, Databricks MCP server | `TOOLS: Record<string, ToolFn>` keyed by the names in `tools.json`; the handler does lookup + validate + call. Adding a tool = one entry + one schema + one test. |
| **Strategy** | orchestrator routing | `processors[docType]` → `AwsDocxProcessor` / `DatabricksPdfProcessor`, each with `run(job, mode)`; the agent prompt describes the strategy, the code enforces it. |
| **Adapter over MCP clients** | agents | `ToolBackend` interface (`list_tools`, `call`) with `GatewayBackend` (Cognito JWT) and `DatabricksBackend` (OAuth M2M) so the orchestrator never knows which cloud a tool lives in. |
| **Factory with cache** | tokens, clients, model | `get_bedrock_model()`, `get_mcp_client(name)`, `cognito_m2m_token()` – created once, cached until expiry, no module-level side effects at import time. |
| **State machine** | job status | Allowed transitions table (`PENDING_UPLOAD→UPLOADED→QUEUED→PROCESSING→COMPLETED/FAILED`, `UPLOADED→PROCESSING` for sync). `JobStore.updateStatus` rejects illegal transitions with `ValidationError`. |
| **Append-only event trace** | jobs | `events[]` is never edited; `status`/`result` are projections. Every step appends `{ts, source, agent, tool, message}`. |
| **Result objects across boundaries** | MCP tools, agent↔agent | Tools return `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Never throw across an MCP or HTTP boundary; map to errors at the edge. |
| **Idempotent steps** | S3 trigger, async workflow | Re-running a step with the same `jobId` is safe: `putIfAbsent`, conditional updates, `run_id` stored before polling. |
| **Retry + timeout wrapper** | cross-cloud HTTP | `withRetry(fn, { attempts: 3, backoffMs: 500, jitter: true })` / `retrying()` in `docintel_common/http.py`; retry only on 5xx/429/timeouts. |
| **Streaming pipeline** | API `/process`, `/chat` | AgentCore SSE bytes are piped, not buffered; the API never parses model output. |

**Do not use:** singletons with hidden mutable state, module-level network calls, inheritance hierarchies deeper than one level, "utils.ts" grab-bags, ORMs, global try/except wrappers, dynamic `eval`/`exec`, string-typed statuses (use `const` unions / `Enum`).

---

## 10. HTTP API conventions (Lambda Function URL)

- **Paths**: plural nouns, kebab-case, no trailing slash: `/uploads`, `/jobs`, `/jobs/{jobId}`, `/jobs/{jobId}/process`, `/chat`, `/health`. No verbs in paths except the `process` action, which is a sub-resource action by design.
- **Methods**: `GET` read-only and idempotent; `POST` create/act. No `PUT`/`DELETE` in v1.
- **Request validation**: zod schema per route in `routes/schemas.ts`; invalid → `400` with the zod issues list.
- **Responses**: JSON, `camelCase` keys, ISO-8601 UTC timestamps, ids as strings. Lists return `{ items: [], nextCursor?: string }`; `?limit=` default 50, max 200.
- **Errors**: one envelope everywhere: `{ "error": { "code": "JOB_NOT_FOUND", "message": "…", "requestId": "…" } }`. Status mapping: `ValidationError→400`, `NotFoundError→404`, `ConflictError→409`, `UpstreamError→502`, unknown→`500` (message hidden, requestId shown).
- **Headers**: every response carries `x-request-id` (Lambda request id) and `cache-control: no-store`. CORS is handled by the Function URL config only – handlers never set CORS headers.
- **Streaming (SSE)**: `content-type: text/event-stream`; each frame `data: <json>\n\n`; event `type` ∈ `status | tool | token | result | error | done`; `done` is always the last frame; a `: ping` comment every 15 s keeps proxies alive; the client treats a closed stream without `done` as an error and re-fetches `GET /jobs/{jobId}`.
- **Idempotency**: `POST /uploads` accepts an optional `idempotencyKey`; the same key returns the same `jobId`.
- **Versioning**: none in v1 paths; a breaking change adds `/v2/…` rather than mutating shapes.
- **Timeouts**: API Lambda 15 min (streaming), non-stream routes must answer < 3 s; anything slower becomes async + polling.

---

## 11. MCP tool conventions (AWS Gateway + Databricks App)

- **Names**: `verb_noun` snake_case, ≤ 30 chars, stable once published (`get_job`, `extract_docx_text`, `run_pdf_agent`).
- **Descriptions**: first sentence says *what*, second says *when to use / when not to*, third lists side effects. Written for the model, not for humans.
- **Input schema**: JSON Schema `object`, all required fields listed, every property has a `description`, enums for closed sets (`mode: "sync"|"async"`), no nested objects deeper than 2 levels, strings for ids.
- **Output**: small JSON (< 8 KB) shaped `{ ok, data | error }`; large text (extracted documents) is truncated to 20 K chars with `truncated: true`; never return binaries.
- **Side effects**: read tools never mutate; mutating tools are idempotent for the same `job_id` + step; every mutation appends a job event.
- **Auth**: Gateway tools are called with a Cognito JWT scoped to `docintel-gw/invoke`; Databricks tools with a service-principal OAuth token. Tools never accept credentials as arguments.
- **Schema as source of truth**: `aws/lambdas/tools.json` and the Databricks `@mcp.tool` signatures are validated by tests against the handler registry (every schema has a handler, every handler has a schema).

---

## 12. Observability, config, security

- **Logs**: one JSON object per line: `{ ts, level, service, jobId?, sessionId?, requestId?, event, msg, ...fields }`. Levels: `debug` (local only), `info`, `warn`, `error`. Never log document text, tokens, or secrets.
- **Correlation**: `jobId` is the correlation id across S3 → Lambda → AgentCore → Gateway → Databricks → UC table. AgentCore `runtimeSessionId` is derived from it (`{jobId}-{mode}`).
- **Config**: read env once in `config.ts` / `config.py` into a typed, validated object (zod / pydantic `BaseSettings`); modules import the object, never `process.env` / `os.environ` directly.
- **Secrets**: AWS Secrets Manager (`docintel/databricks`, `docintel/aws-mcp`) and Databricks secret scope `docintel`; cached in memory ≤ 5 min; rotation needs no redeploy.
- **Security checklist per change**: least-privilege IAM via L2 `grant*`; presigned URLs ≤ 15 min; JWT authorizer pins `allowedClients`; no public buckets; input validated at every boundary; dependencies pinned; no `eval`.
