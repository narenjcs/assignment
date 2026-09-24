# UI polish plan

Goal: make the architecture **visible**. Someone watching the demo should understand, without
narration, that a DOCX stays inside AWS while a PDF crosses into Databricks and calls back — and
should be able to tell sync from async before they pick one.

Three deliverables, in priority order.

---

## 1. Live agent-flow diagram (the centrepiece)

An inline SVG of the pipeline that **animates as the job runs**, driven by the job's existing
`events[]` trace and, in sync mode, by the live SSE stream. No new backend work: every event
already carries `source` (`aws` | `databricks` | `orchestrator`), `agent`, `tool`, `message`
and `ts`.

**Layout** (single row of stages, left to right, grouped into two cloud bands):

```
  ┌── AWS ─────────────────────────────────────────────┐   ┌── Databricks ──────────────┐
  Browser → S3 → Trigger → Orchestrator ─┬─ DOCX Agent  │   │                            │
                                          └──────────────┼──→ PDF Agent → Volume → Table │
                            ▲                            │        │                      │
                            └──────── MCP Gateway ◄──────┼────────┘  (callback)          │
  └────────────────────────────────────────────────────┘   └────────────────────────────┘
```

**Node states** — derived, never stored:
| State | Visual |
|---|---|
| pending | outline only, muted |
| active | filled, soft pulse, animated edge into it |
| done | filled, check, cloud-tinted |
| failed | red ring + cross |
| skipped | dashed outline, 40% opacity (e.g. the Databricks band on a DOCX job) |

**Mapping events → nodes** (pure function, unit-tested):
- `api/create_job` → Browser, S3
- `s3-trigger/s3:ObjectCreated` → Trigger
- `orchestrator/*` → Orchestrator
- `source=databricks` + `tool` ∈ {ingest, extract, enrich, persist} → PDF Agent sub-steps
- any `tool` ∈ the 7 gateway tools → pulse the MCP Gateway edge (this is the cross-cloud proof)
- `docx-agent/*` → DOCX Agent
- terminal status → all remaining nodes resolve

**Interaction**: hover a node → tooltip with the actual events that hit it (tool name + relative
time); click → scroll the trace list to that event. Respect `prefers-reduced-motion` (no pulse,
state changes only).

**Why SVG in React, not a static image**: it must reflect *this* job. One `<FlowDiagram job=…>`
component, ~200 lines, no new dependency.

---

## 2. Sync vs async, explained where the choice is made

Today the mode toggle is two radio buttons with no explanation. Replace with two selectable
cards:

| | **Sync** | **Async** |
|---|---|---|
| headline | Watch it happen | Fire and forget |
| body | Streams tokens live as the agents work. Best for a demo. | Returns immediately; the job runs in the background and the list updates. Best for bulk or slow documents. |
| detail | Browser holds an SSE connection to the API Lambda | S3 event triggers the orchestrator; UI polls |

Plus a small persistent info note under the diagram: *"Sync and async are about **how you
watch**, not what runs — both use the same agents. The document type decides the cloud: DOCX
stays in AWS, PDF is processed in Databricks."* That sentence pre-empts the most common
misunderstanding.

---

## 3. Visual modernisation

Keep Tailwind 4; no component library.

- **Type**: one display face for headings, tabular numerals for metrics.
- **Depth**: soft shadows and 1px hairline borders instead of heavy boxes; 8px rhythm.
- **Colour**: AWS amber and Databricks red used *only* for provenance (badges, diagram bands,
  trace rail), so colour always means "which cloud". Neutral greys elsewhere.
- **Dark mode**: `prefers-color-scheme`, semantic tokens in `globals.css`.
- **Trace list**: vertical timeline with a cloud-coloured rail, monospace tool names, relative
  timestamps, collapsed by default once COMPLETED.
- **Result card**: summary first at readable measure, then key points, then entity chips grouped
  by type, then a compact metadata grid (pages, words, method, model, UC table).
- **Empty/loading**: skeletons rather than spinners; the diagram renders greyed-out before upload
  so the architecture is visible even with no job.
- **A11y**: state never colour-only (icon + label), focus rings, live region announcing status
  changes, keyboard-operable diagram nodes.

---

## Plan of work

| # | Task | Est. |
|---|---|---|
| U1 | `lib/flow-model.ts` — pure events→node-state mapping + tests | 0.5 d |
| U2 | `components/FlowDiagram.tsx` — inline SVG, states, tooltips, reduced-motion | 1 d |
| U3 | Mode cards + info note (`features/upload/ModeCards.tsx`) | 0.3 d |
| U4 | Design tokens, dark mode, typography pass in `globals.css` | 0.4 d |
| U5 | Trace timeline + result card restyle | 0.5 d |
| U6 | Skeletons, a11y pass, `npm run lint && npm test && npm run build` green | 0.3 d |

**Constraints** (unchanged): `docs/DEVELOPMENT.md` applies — components ≤ 150 lines, functions
≤ 50, no `any`, no business logic in JSX, tests for every pure function. No new runtime
dependency: the diagram is hand-written SVG.

**Out of scope**: rewriting the API, auth, or the agents. This is presentation only.
