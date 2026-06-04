# Project experience log

Running memory of what we've *tried*, what stuck, and what didn't — so we don't
re-walk dead ends. Two parts:

- **What didn't work** — abandoned approaches, each with the "didn't work"
  treatment: what we tried, whether we know *why* it didn't work, and (if known)
  the reason. "Direction feels unideal" is allowed, but say so explicitly rather
  than dressing it up as a technical reason.
- **Version history** — one entry per merge to `main`, summarising the changes
  vs the previous version.

Maintained as part of the dev workflow (see `CLAUDE.md`): update on every merge
and on every branch removal.

---

## What didn't work

### Buy/hold signal by thresholding the composite heat
Shaded the price green/grey by a smoothed composite-heat score crossing a
threshold (tried both sign conventions). **Why it didn't work (known):** the
composite was a *trend-regime* gauge — negative through up-markups, positive
through down-falls — not a buy-timer. Thresholding it either painted the entire
rise green ("buy after it already went up") or painted crashes green. The
owner's actual thesis (buy choppy accumulation *before* a rise, hold through
downfalls) needs a chop + stabilisation detector, not a heat threshold.

### The M/W composite-heat subsystem
A multi-horizon W/M pattern matcher (soft-Viterbi phase machine) pooled across
daily/weekly/monthly via atanh into one heat score, plus a Components
diagnostic. **Why it didn't work (mostly direction, partly known):** heavy
machinery one abstraction removed from how the owner reasons about the market;
its output never mapped cleanly to action. The simpler run/scale metrics (b,
runs, price ÷ MA) were clearer and more directly tunable, so the whole subsystem
was removed in favour of `lib/runs.ts`.

### price ÷ MA against a short indicator MA
First version divided price by the on-chart MA (20d default); the ratio hugged 1
with high-frequency noise and couldn't separate regimes. **Why (known):** a
short MA chases price, so the ratio has no slow baseline to swing against. Fix
that worked: a long, slow baseline (4yr / 1460d, tunable) on a **log** y-axis,
matching the Price Mechanics tab.

### Run-slope coloured from raw-price endpoints
The run-slope bars disagreed with the b-graph's run shading. **Why (known):**
the slope was computed from raw price at each run's two endpoints, which is noisy
and on short runs can flip sign vs the run's sustained direction. Fix: measure
the slope on the *smoothed* price the runs are built from, and colour by run
direction — now the two graphs agree run-for-run.

### Linear run-scale slider
A linear slider crammed daily/weekly/monthly into the bottom few percent. **Why
(known):** run scales span orders of magnitude (1–1500 days). Fix: a log slider
whose label snaps to the nearest named scale (daily…multi-year).

### Heat-band DCA prototype (`claude/dca-explorer`, stranded)
An early buying-strategy exploration scoring a "heat-band buy method vs uniform"
over a rolling horizon (`dcaScore`/`dcaSweep`/`dcaTimeline` in `indicators.ts`,
plus sweep/timeline charts). **Why it didn't work (known):** built entirely on
the M/W heat engine that was later removed, so the driver no longer exists; and
the framing (growth-multiple vs uniform) doesn't match the owner's updated
vision. Superseded by the freshly-designed **Hodl Explorer** (see
`docs/TODO.md`) — **do not revive the code**, but the *mechanics below* are
worth keeping as prior art.

**Scoring idea (causal, scale-free).** Judge a buying *method* by how cheaply it
bought, relative to buying every day, measured at a later vantage point — never
peeking past the day a decision is made.

- For each evaluation day `t`, look back `daysBack` (X) over the window
  `[t−X, t]`.
- A **method** buys on the subset of days in that window that satisfy a rule;
  the **uniform** benchmark buys on *every* day in the window.
- Value each set of buys at day `t`, scale-free (a growth multiple, so dollar
  size and absolute price level drop out):
  - `growth_method(t)  = mean over method-days j in [t−X, t] of price[t]/price[j]`
  - `growth_uniform(t) = mean over all days   j in [t−X, t] of price[t]/price[j]`
- The day's edge is `growth_method(t) / growth_uniform(t)`; **> 1** means the
  method's buy-days were cheaper (higher subsequent growth) than buying daily.
- The method's overall **score** is that ratio averaged over all evaluation
  days. Scoring over a *finite* X-day horizon (not all the way to "today") stops
  a handful of ancient ultra-cheap days from dominating every window.

**The specific rule that was tried: a heat band.** Buy on days whose M/W heat
falls in `[center − window, center + window]` (i.e. "buy a particular band of
oversold-ness"). Two knobs: band **center** and **window** (entered as numeric
inputs in the end, after sliders proved fiddly).

**Reported metrics (the `Dca*` interfaces):**
- `dcaScore` → `{ score, beatRate, methodGrowth, uniformGrowth, coverage,
  evalDays }`. `beatRate` = fraction of eval days where method ≥ uniform;
  `coverage` = mean (band-days / window-days), i.e. how often the rule actually
  bought. A day needs ≥1 method-day *and* ≥1 uniform-day to be scored.
- `dcaSweep` → sweep the band `center`, yielding `{ center, score, coverage }`
  points — an at-a-glance curve of "which oversold band paid best," rendered by
  `DcaSweepChart.vue`.
- `dcaTimeline` → per-day `{ index, methodGrowth, uniformGrowth, ratio,
  coverage }`, a "days like today" attractiveness trace rendered by
  `DcaTimelineChart.vue`.

**Design notes / lessons carried forward:**
- *Average over all start days*, not a single lump entry — removes luck-of-the-
  entry-date and makes the score about the *rule*, not the timing of one buy.
- *Coverage matters as much as score*: a rule that scores 1.3 but only fires 2%
  of the time (tiny coverage) is near-useless for steady accumulation — always
  show both.
- *Growth-multiple framing has a blind spot*: it measures "did I buy cheaply"
  but **not** realised ROI, cost basis, drawdown, or "was the cash actually
  deployable." The fresh design should simulate an actual budget/position, not
  just average price ratios.
- *Generalise the driver*: the band rule was hard-wired to heat. A future
  explorer should take any causal metric (price ÷ MA, b, run state) → buy-days,
  reusing the rolling-horizon vs-uniform scoring as one of several lenses.

### Metric registry (data-driven toggles + persistence) — built, never merged
On `claude/inspiring-bardeen-lHExI` (commit `cec9ac2`), a spec-driven metric
system replaced the Price Explorer's individual toggle refs: `lib/metricRegistry.ts`
with `MetricSpec` / `MetricState`, `defaultMetricState` / `load` / `save`, and
`encode` / `decodeMetricState` for URL-shareable views, with `PriceExplorer.vue`
rendering `v-for` over the specs from a single `metricState` ref + localStorage
persistence. **Status:** lives only on that branch — **never merged to `main`**.
**Why it didn't land (mostly direction):** the indirection (spec registry +
encode/decode + a state blob) outweighed the benefit for ~five toggles, and the
later Bollinger-score unification and consolidation kept the simpler plain-ref
toggles. **Doc drift it left behind:** `TODO.md` lists "Indicator setup — metric
registry" under **Done** and `system-design.md` referenced `metricRegistry.ts`,
but on `main` the toggles are plain in-memory refs with **no** persistence or URL
sharing. Reconciled: system-design §3/§7 now say so, and the TODO entry was moved
out of Done into Later / ideas.

---

## Version history

### 2026-06-03 — Concept tooltips (InfoTip + glossary)
- **Added:** `components/InfoTip.vue` — a tap/hover info bubble for beginners —
  and `lib/glossary.ts`, a `GLOSSARY` map (term → 1–3-sentence plain-English
  definition) referenced by key (`<InfoTip term="ma" />`), seeded with the
  indicator/forecast terms.
- **Why:** the indicators are heuristics; inline definitions lower the barrier
  without cluttering the controls. Single source — one glossary entry per
  concept, reused wherever the term appears.

### 2026-06-03 — Code consolidation (single source of truth)
De-duplication pass after the feature run (Indicator setup, Hodl Explorer,
Bollinger-score unification onto `bandPosition`, marked help renderer, bitcoin1460
rebrand, CI gate + Vitest). Extracted shared modules: `lib/format.ts`
(`fmtUSD`/`fmtPct`/`fmtBtc`, was copied in 6 components), `lib/chartTheme.ts`
(ECharts colour tokens), `lib/usePriceSeries.ts` (`prices`/`dates`/`toDateInput`),
and `lib/useBandScore.ts` (the Bollinger-score state + series, was duplicated
verbatim across the Price Explorer and Hodl Explorer; each call keeps its own
params). No behaviour change except `fmtUSD` now uses auto precision everywhere.
Also reconciled `docs/TODO.md` (merged work → Done) and started
`docs/system-design.md` — a scalable developer/system doc; the forecast model
(formerly `forecast-model.md`) is reorganised into §5.2, with placeholder
sections for the rest of the system (tracked in `TODO.md`).

### 2026-06-03 — CI gate + unit tests (Vitest)
- **Added:** `.github/workflows/ci.yml` — on PR → `main` and push → `main`:
  `npm ci` → `npm run test:run` → `npm run build` (`vue-tsc -b && vite build`).
  Node 22 + npm cache (matches `deploy.yml`); `concurrency` cancels superseded
  runs. The first automated guard against a broken build reaching history.
- **Added:** Vitest + seed tests in `src/lib/{hodl,indicators}.test.ts` (hodl
  ROI / cost-basis + band-date selectors; `sma`/`ema`/`bollinger`/`bandPosition`
  incl. a causality assertion). Tests excluded from the app type-check
  (`tsconfig.app.json`).
- **Remaining:** mark the `build` check **required** in branch protection
  (manual GitHub setting; see `TODO.md`).

### 2026-06-03 — Bollinger score unified onto `bandPosition`; marked renderer
- **Changed:** the Bollinger score became a single source of truth —
  `indicators.ts` `bandPosition = (EMAₛ(price) − SMA_W) / (k·σ_W)`, centered
  (±1 = ±kσ). Replaced the old run-scale score and the separate classic-%B curve
  (%B is just smoothing 0 + a short window). Used by both the Price Explorer
  curve and the Hodl `bscore` driver, each keeping **independent** Period / σ /
  Smoothing params; the long-MA window is likewise decoupled per tab.
- **Changed:** help rendering switched from the hand-rolled `lib/markdown.ts` to
  `marked`.
- **Defaults:** Bollinger score → 20 months · 2σ · 31-day smoothing (both tabs).

### 2026-06-02 — Rebrand to bitcoin1460
- **Changed:** app name + icon to **bitcoin1460** (the 1,460-day = 4-year MA
  motif), with a centered Ubuntu/Orbitron title banner and PWA icons generated
  from a single source image.

### 2026-06-03 — Conceptual help docs + in-app help button
- **Added:** `docs/concepts/{overview,price-explorer,price-mechanics,hodl-explorer}.md`
  — conceptual documentation of each page (purpose, controls, how it works,
  assumptions/caveats), written to be read by both an AI agent and an end user.
  These files are the single source: a **? Help** button (top-right of the
  header) opens `HelpModal.vue`, which imports them via Vite `?raw` and renders
  them with a small per-page nav, defaulting to the active tab's doc.
- **Added:** `lib/markdown.ts` — a tiny, dependency-free Markdown→HTML renderer
  (headings, paragraphs, fenced/inline code, bold/italic, links, hr, nested
  lists). Chosen over a library because the sandbox can't reach npm and the docs
  are trusted, app-authored content.
- **Why this shape:** keeping the docs as plain `.md` in `docs/concepts/` (not
  inline in components) means they stay diff-able, agent-readable, and reusable;
  the app renders the same files rather than a duplicated copy.

### 2026-06-02 — Hodl Explorer tab
- **Added:** a buying-strategy sandbox (`lib/hodl.ts`): a seed-layer combinator
  where drivers (price ÷ MA band, Bollinger-score band, uniform spacing, manual
  dates) resolve to frozen layers unioned into a strategy; a trailing-days **or**
  from/to comparison window; a shared cash budget; `simulateStrategy` (ROI / cost
  basis / BTC) with strategy-vs-baseline **and** live preview-vs-baseline stats
  (`StatsCompare.vue`); and a Buy/Hodl indicator card (per-pattern BUY/HODL for
  today). Price + driver-metric charts x-synced; out-of-window manual dates are
  flagged and excluded.
- **Context:** supersedes the stranded heat-band DCA prototype (see "What didn't
  work") — actual budget/position simulation rather than average price ratios.

### 2026-06-02 — Run/scale metric framework (replaces composite heat)
Merge of the metric-framework work. Changes vs previous version:
- **Added:** `lib/runs.ts` (`scaleDiag(price, hd)` → b, trend vote, runs at one
  continuously-tunable scale); a metric-toggle UI in the Price Explorer where
  each metric toggles independently and carries its own collapsible config.
  Overlays: Moving average, Bollinger bands, Run detection (run skeleton + run
  slope). Separate curves: Price ÷ MA (long-MA, log axis), Bollinger score,
  Run slope. Run detection + Bollinger score share scale + sensitivity. The
  additional-graphs panel is collapsible. Crosshair + x-zoom sync across all
  panels via `echarts.connect`.
- **Removed:** the M/W composite-heat tint, the buy/hold signal, and the
  Components diagnostic — `mwHeat`, `phaseMachine`, `MwHeatDiagnostic.vue` (see
  "What didn't work").
- **Defaults:** run scale ≈ 31d, sensitivity 0.2; default view is price only.
- **Docs:** added `CLAUDE.md` and this `experience.md`; retired the old DCA
  Explorer plan in `docs/TODO.md`.
