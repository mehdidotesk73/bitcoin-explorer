# Forecast tab — TODO

## Done

- [x] Interactive cycle-peak editor: move peak dates with sliders, add/remove a
      peak, clear all, and redistribute to the default tops.
- [x] Envelope band on the Price tab: shaded cone between the value baseline
      (`modelMa`) and the envelope-lifted ceiling (`modelMa × envelope`).
- [x] Restructure the price-mechanics input panel: a distinct "Calibration"
      section for the fitting knobs that overwrite the params (MA window, fit
      window, day zero, recency weighting γ, Reset to fit), separated from the
      hand-tunable model-parameter sections, with clearer labels.
- [x] Clearer model-selection naming (display labels only; underlying type
      values unchanged):
  - "Envelope" → "Volatility projection"; options → "Time-based exponential
    decay", "Value-based power decay", "Value-based exponential decay",
    "Constant".
  - "Value growth" → "Growth projection"; options → "Time-based power-law",
    "Time-based exponential", "Time-based linear".
  - "Peaks" → "Cycle peaks"; the kernel is `e^(−spread·|x−dᵢ|)` (double
    exponential), so the option is labelled "Laplacian" / "None".
  - "Horizon" left as-is (already clear).

- [x] Linear slope as an Nth-percentile trailing slope. Replaced the fixed
      min/median/mean/max variant with a `percentile()` helper + three params on
      `fitParams`: `slopeRangeDays` (how far back to gather samples),
      `slopeWindowDays` (span each slope is measured over — daily/weekly/
      monthly/yearly preset), and `slopePercentile` (0–100); dropped the
      `SlopeVariant`/`slopeStats` API. UI: "Slope range (days)", "Slope window"
      preset, and "Slope percentile" inputs in the Calibration section.

- [x] M/W price-heat indicator (Price Explorer). Colours the price by how it
      oscillates around its moving average: a smoothed (price−MA)/MA oscillator
      is cross-correlated against an idealised W/M template, giving a signed
      heat in [−1, +1]. Blue = W-bottom (two dips below the MA, bullish), red =
      M-top (two pushes above, bearish), neutral on flat/choppy stretches.
      Rendered as per-point coloured scatter dots over a faint price line
      (visualMap/line-segment colouring don't bind on a category axis), with a
      "M/W heat" toggle and an explainer tooltip.

- [x] Run/scale metric framework (Price Explorer), replacing the composite-heat
      subsystem. The engine is now `lib/runs.ts`: `scaleDiag(price, hd)` derives
      b, the sustained-trend vote, and runs at one continuously-tunable scale.
      The UI is a metric toggle list — Moving average, Bollinger, Runs overlay
      (all overlays), and Price ÷ MA, b score, Run slope (separate curves) —
      each with its own collapsible config; b / runs / run-slope share a "Run
      parameters" group (log scale slider + sensitivity). Default view is price
      only. **Removed:** the M/W composite heat tint, the buy/hold signal, and
      the Components diagnostic (`mwHeat`, `phaseMachine`, `MwHeatDiagnostic`).

## Next branch — Indicator setup

> Deferred to a follow-up branch, to be started after the current
> metric-framework branch is merged.

### Indicator setup (do first)

The Price Explorer now has a metric-toggle framework: each metric is toggled
on/off, has its own collapsible config, and run-based metrics (b, runs overlay,
run slope) share one "Run parameters" group. Next:

- Promote the ad-hoc metric list into a small registry/spec (id, label, kind =
  overlay | curve, param schema, shared-param group) so metrics + their configs
  render from data instead of hand-written rows.
- Persist enabled metrics + params (localStorage / URL) so a view is shareable.
- Tidy defaults and grouping; make adding a new indicator a one-entry change.
- This registry is also what a future strategy-explorer's metric picker reads.

## Later — Hodl Explorer (after Indicator setup)

The owner's buying-strategy feature (replaces the retired DCA Explorer; **do
not** revive the heat-band prototype — see `docs/experience.md`). Builds on the
Indicator-setup metric registry, so it comes after that branch lands.

**Idea.** Seed a set of purchase dates over the price history, then live-simulate
"buy a uniform amount on each seeded date" and compare it against a baseline of
"buy a uniform amount on every day in the past X days."

### Seeding the purchase dates
- **Manual** — the user picks / adds individual dates (and can remove them).
- **Pattern spreading via indicators** — an indicator (from the metric registry)
  generates dates by spreading purchases across the days that meet a condition
  (e.g. buy where price ÷ MA < T, or where a run is in a chosen state). The
  indicator's params come from its registry config.
- **Combination** — manual dates plus indicator-spread dates, merged.

### Live simulation + comparison
- **Strategy:** uniform amount on each seeded date.
- **Baseline:** uniform amount on every day over the trailing X days (X is a knob).
- **Compare (current worth & more):** value today, **cost basis** (avg buy
  price), BTC accumulated, ROI %, number of buys / amount deployed, and other
  side-by-side stats. Recompute live as the seeding or params change.

### Notes
- Reuse `useBitcoinData`; keep the simulation a pure function in `src/lib/` over
  the fetched arrays (causal where relevant), components thin.
- Indicator-driven seeding is exactly why **Indicator setup comes first** — the
  explorer reads the available drivers and their configs from that registry.

## Housekeeping / ideas

- [ ] Add a CI build + type-check gate on PRs (a broken-build commit reached
      history on the forecast-tab branch because nothing ran `npm run build`).
