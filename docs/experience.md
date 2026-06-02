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
vision. Superseded by a future, freshly-designed strategy explorer. The only
salvageable idea is the *causal, scale-free* evaluation style (average
`price[t]/price[j]` over buy-days, scored over a finite rolling horizon, vs a
uniform benchmark) — reference, don't revive the code.

---

## Version history

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
