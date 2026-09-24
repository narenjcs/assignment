# UI polish plan

Goal: make the architecture **visible**. Someone watching the demo should understand, without
narration, that a DOCX stays inside AWS while a PDF crosses into Databricks and calls back — and
should be able to tell sync from async before they pick one.

Three deliverables, in priority order.

---

## 1. Agent-flow view — opened from a "View flow" button

**Not inline in Job detail.** Job detail stays compact (status stepper → result card → agent
trace) with a single **View flow** button. Clicking it opens a full-width overlay containing the
architecture view below. That keeps the detail pane readable and makes the diagram an event —
which is what you want in a demo.

### Target look (from Naren's mockup)

A dark "console" canvas, deliberately unlike the rest of the app:

```
SYSTEM ARCHITECTURE FLOW

AWS ─────────────────────────────────      │   DATABRICKS ──────────────────
                                           │
 ┌────────┐  ┌────────┐  ┌────────┐        │
 │BROWSER │→ │   S3   │→ │TRIGGER │→ ┌──────────┐      ┌────────┐
 │Completed│  │ Active │  │ Active │   │ORCHESTR. │  →   │ VOLUME │
 └────────┘  └────────┘  └────────┘   │  Active  │ │    │ Active │
                              ↘        └──────────┘ │    └────────┘
                           ┌──────────┐      ↓      │  ┌──────────┐
                           │DOCX AGENT│ →  ┌─────────┐ │  TABLE   │
                           │  Active  │    │PDF AGENT│ │  Active  │
                           └──────────┘    │ Active  │ └──────────┘
        ┌────────────┐                     └─────────┘
        │MCP GATEWAY │ ◀┄┄┄┄┄ BACKWARD FLOW ┄┄┄┄┄┘
        │  Skipped   │
        └────────────┘
```

Specifics that make it look like the mockup:
- **Dark canvas** (`#0a0a0b`) with a faint 1px grid, regardless of the app's light/dark setting —
  this panel is always dark.
- **Two labelled columns**, `AWS` and `DATABRICKS`, each with a coloured underline in its cloud
  colour, separated by a vertical divider.
- **Node = rounded square card**: line icon on top, UPPERCASE label, then a small **status pill**
  (`Active` / `Completed` / `Skipped` / `Failed`).
- **Glow, not fill**: an active node has a coloured border plus an outer glow in its cloud colour
  (amber on the AWS side, red on the Databricks side). Completed is a calm neutral card with a
  check. **Skipped is grey, dashed, ~45% opacity** — so a DOCX job visibly greys the whole
  Databricks column, which teaches the routing rule in one glance.
- **Arrows** are thin white/neutral connectors with small heads.
- **The backward flow is the point**: a **dashed** line from PDF Agent back to MCP Gateway,
  labelled `BACKWARD FLOW`. That edge is the visual proof of the brief — an agent in Databricks
  calling an MCP server in AWS — so it gets its own label and animates when it fires.

### Behaviour

- Driven by `lib/flow-model.ts` (already built and tested): job `events[]`, plus live SSE events
  in sync mode.
- Opens as a dialog: focus trapped, `Esc` closes, `role="dialog"` + `aria-label`, returns focus
  to the button. Body scroll locked while open.
- Nodes are focusable; hover/focus shows the real events that hit that node (tool + relative
  time).
- Active node and its incoming edge animate; everything respects `prefers-reduced-motion`.
- Opens fine with no job selected: every node `pending`, which doubles as an architecture
  overview.
- Scrolls horizontally on narrow screens rather than squashing.

Hand-written inline SVG (plus a little CSS for the glow). **No new runtime dependency.**

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
- **Colour**: **no yellow anywhere.** The AWS token was `#ff9900`, which reads as yellow and
  fails contrast for text on white; it becomes a deeper orange (a separate bright accent may be
  kept for large fills only, never text). Orange and red are reserved *exclusively* for cloud
  provenance (badges, diagram bands, trace rail). **State uses a different hue family** — sky for
  queued, indigo/violet for in-flight, emerald for done, red reserved for failure — so a reader
  can never confuse "which cloud" with "what state". Neutral greys elsewhere.
- **Dark mode**: `prefers-color-scheme`, semantic tokens in `globals.css`.
- **Trace list** — the primary visual *inside* Job detail (the diagram lives behind the View
  flow button), so it still has to read well on its own: vertical timeline with a cloud-coloured rail so the AWS→Databricks
  →AWS hand-offs are obvious at a glance, monospace tool names, relative timestamps, and a row
  per event exactly as the API returns it. Grouped by cloud, collapsed once COMPLETED but
  expandable. Job detail is: status stepper → result card → agent trace.
- **Result card**: summary first at readable measure, then key points, then entity chips grouped
  by type, then a compact metadata grid (pages, words, method, model, UC table).
- **Empty/loading**: skeletons rather than spinners; the diagram renders greyed-out before upload
  so the architecture is visible even with no job.
- **Scrolling**: each panel owns its scroll region — jobs list, job detail (trace + result) and
  chat scroll independently inside a viewport-height shell, so a long trace never grows the page.
  Requires `min-h-0` on flex children (the usual flexbox overflow trap) and
  `scrollbar-gutter: stable` to avoid layout shift. The flow diagram stays pinned while the trace
  scrolls beneath it. On mobile the columns stack, each still scrollable.
- **A11y**: state never colour-only (icon + label), focus rings, live region announcing status
  changes, keyboard-operable diagram nodes.

### 3.1 Palette (the one to implement)

Audience: US cloud/data engineers and architects evaluating this as a work sample. What reads as
credible to them is **restraint** — the visual language of Linear, Stripe, Vercel and the
Databricks brand site: near-black surfaces, generous whitespace, one confident accent, and colour
that *means something*. Deliberately **not** patriotic red/white/blue, which reads as novelty and
undercuts the engineering.

Three colour jobs, never mixed:

| Job | Family | Tokens |
|---|---|---|
| **Provenance** — which cloud did this | warm | `--color-brand-aws: #c2410c` (deep orange; `#ff9900` only as a large-fill accent, never text) · `--color-brand-databricks: #ff3621` (their real brand red) |
| **State** — what is happening | cool | queued `#0284c7` sky · in-flight `#6366f1` indigo · done `#059669` emerald · failed `#e11d48` rose |
| **Surface & text** — everything else | neutral | light: `#fafaf9` page / `#ffffff` card / `#0c0a09` ink · dark: `#0a0a0b` page / `#141416` card / `#fafaf9` ink |

**Primary accent: indigo `#6366f1`.** Cool, so it never competes with the two warm provenance
colours, and it is the current visual signal for AI tooling in US SaaS. Use it for the active
state, focus rings, primary buttons and the live edge in the flow diagram — and nowhere else.

Rules that make it look designed rather than decorated:
- **One accent.** If something is not interactive, in-flight, or focused, it is neutral.
- **Colour is never the only signal** — always paired with an icon or label (also the a11y rule).
- **Borders are hairlines** (`1px`, ~8% ink) and shadows are soft and low (`0 1px 2px`,
  `0 8px 24px -12px`). No thick outlines, no chunky drop shadows.
- **Contrast is checked**, not assumed: body text ≥ 7:1, secondary ≥ 4.5:1, in both themes.
- **Dark mode is the default-looking one.** Engineers demo in dark; make it the polished path and
  ensure light is equally correct.
- **Type**: one sans (system stack is fine and fast), 1.25 scale, `font-variant-numeric:
  tabular-nums` for every metric so figures align.
- **Motion is quiet**: 150–200 ms ease-out, only on state change; nothing loops except the single
  in-flight pulse, and that respects `prefers-reduced-motion`.


---

## 4. Deployment

The SPA is a static build served by CloudFront from a private S3 bucket; the API is routed
through the **same** distribution, so the app is single-origin (no CORS, one hostname to
resolve — see PLAN.md §0.1 item 7).

### How it ships

```bash
make deploy-frontend     # SPA only — build, S3 sync, CloudFront invalidation (~19s, measured)
make deploy-aws          # full stack — use when infrastructure itself changed
```

`make deploy-frontend` deliberately bypasses CloudFormation: it syncs `frontend/dist` to the web
bucket, rewrites `config.json` with the live API URL, and invalidates `/*`. It touches only
bucket contents, never infrastructure, which is what makes it safe to run repeatedly while
iterating on the UI. Reach for `make deploy-aws` when a construct changed.

`make deploy-aws` is the only step that touches AWS. Inside it, the CDK `Web` construct does two
things that matter for the UI:

1. **`BucketDeployment`** uploads `frontend/dist` to the web bucket and issues a CloudFront
   invalidation for `/*`, so a redeploy is visible immediately rather than after TTL expiry.
   `scripts/deploy-frontend.sh` performs the same two actions directly for the fast path.
2. **Writes `config.json` at deploy time** with the live API URL
   (`{"apiUrl": "https://<distribution>"}`). The bundle never hardcodes an endpoint: `lib/config.ts`
   fetches `/config.json` at startup and falls back to `VITE_API_URL` for local dev. This is why
   the same build artefact works against any stage.

### Verifying a UI deploy

```bash
curl -s https://d3fhr1wqlh1ql9.cloudfront.net/config.json     # apiUrl points at the distribution
curl -s https://d3fhr1wqlh1ql9.cloudfront.net/health          # API reachable on the same origin
curl -sI https://d3fhr1wqlh1ql9.cloudfront.net/ | head -3      # 200, and x-cache on a second hit
```

Then load the page and confirm the flow diagram renders in its idle state with no job selected —
that exercises config load, bundle integrity and the new component in one look.

### Local development

```bash
cd frontend && npm run dev      # Vite dev server
```
Point it at the deployed API with `VITE_API_URL=https://d3fhr1wqlh1ql9.cloudfront.net` in
`frontend/.env.local`; there is no local API, and the browser must be able to resolve the
CloudFront host (the `*.on.aws` Lambda URL is deliberately not used — some resolvers refuse it).

### Rollback

The previous build is not retained in the bucket (deployment prunes), so rollback is
`git checkout <sha> -- frontend && make build-frontend deploy-aws`. For a demo this is
acceptable; a production setup would version the prefix and flip an origin path.

### Cost / cache notes

CloudFront serves the SPA from cache; the API behaviours are `CACHING_DISABLED` because they are
per-request and stream. Invalidations are free up to 1,000 paths/month, and each deploy issues
one (`/*`).

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
| U7 | Review round, then ship: `make build-frontend && make deploy-aws`, verify per §4 | 0.2 d |

**Constraints** (unchanged): `docs/DEVELOPMENT.md` applies — components ≤ 150 lines, functions
≤ 50, no `any`, no business logic in JSX, tests for every pure function. No new runtime
dependency: the diagram is hand-written SVG.

**Out of scope**: rewriting the API, auth, or the agents. This is presentation only.
