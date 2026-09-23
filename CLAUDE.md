# DocIntel – project instructions for AI agents

1. Read `docs/DEVELOPMENT.md` fully before writing or editing code. Its rules are binding (file ≤ 300 lines, function ≤ 50 lines, no `any`, lint clean, tests per module).
2. Work one task at a time from `docs/TASKS.md`; tick it only after `make check` passes.
3. Architecture and contracts are in `docs/PLAN.md` — do not change JSON shapes, tool names, or folder layout without updating the plan in the same change.
4. Cloud targets: AWS account <AWS_ACCOUNT_ID> / `us-east-1`; Databricks CLI profile `docintel` only. Model ids come from env/CDK context, never hard-coded.
5. Never deploy, destroy, push, or spend money without an explicit instruction from Naren.
6. Workflow: Sonnet subagents implement one task each inside their own directory; Fable reviews (`docs/DEVELOPMENT.md` §7.1). Implementers do not edit `docs/TASKS.md`, root configs, or other tasks' directories.
