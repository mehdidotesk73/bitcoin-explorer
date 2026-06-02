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

## Next feature — DCA Explorer (its own tab)

**Goal.** Let the user pick a *metric* to drive a dollar-cost-averaging
strategy, tune that metric's knobs, and compare the resulting ROI against a
plain "buy the same amount every day" benchmark. The metrics panel
(price ÷ MA, b, run-slope) is the menu of drivers; this tab turns them into
spending decisions and scores them.

### Core model

- **Benchmark:** naive DCA — a fixed dollar amount every period (daily default,
  weekly option), price-blind. This is the line every strategy must beat.
- **Strategy:** same *total budget* over the same window, but the per-period
  spend is modulated by the chosen metric so the comparison is purely about
  *timing*, not about investing more money.
- **Report per strategy:** BTC accumulated, average cost basis, final value,
  ROI %, max drawdown, and % of budget deployed (for save-and-buy modes).

### Two spending models (user toggle)

1. **Weighted (always invested):** each period spend `budget · w[i] / Σw`,
   where `w[i] ≥ 0` is the metric's buy-weight. `w` constant ⇒ naive DCA.
   Spends the whole budget; rewards *tilting* buys toward good days.
2. **Save-and-deploy (trigger):** accrue the fixed contribution into a cash
   pile every period; deploy cash (all or a fraction) only when the metric
   *triggers* (e.g. price ÷ MA < T). Rewards *waiting* for dips; leftover cash
   at the end is valued as cash. This is the model that can really diverge
   from naive.

### Pluggable metrics + knob registry

Each driver implements a small interface so the UI can render generic sliders:

```
interface DcaMetric {
  id: string; label: string
  knobs: { id; label; min; max; step; default; help }[]
  // CAUSAL: may only read series[0..i] to decide day i.
  weight(ctx, knobs): number[]   // per-day buy-weight ≥ 0
}
```

Planned drivers and their knobs:

- **price ÷ MA** — knob: threshold `T`. Buy-weight ramps up as the ratio drops
  below `T` (e.g. `w = max(0, T − price/MA)` or a step at `T`). Optional second
  knob: MA window. Cleanest metric to start with.
- **b (band position)** — a raw threshold on `b` is regime-sensitive, so build a
  **derived signal on top of b** first: e.g. trailing-window *percentile rank*
  of `b`, or a normalised "b-dip depth × duration below 0". Knob: percentile/
  depth threshold. (Tracked as a sub-task: "b-driver derived signal".)
- **run-slope regime** — buy in chop (slope ≈ 0) once a down-run has *ended*;
  hold (skip) during active down-runs. Knobs: chop band `±ε` around 0,
  cool-off after a down-run. ⚠️ Causal caveat: a run's average slope is only
  known at the run's *end*, so the in-progress run must be treated as "unknown
  / chop" until it closes — no peeking at the current run's final slope.
- **composite heat** — the existing M/W signal as a weight, for comparison.

### Architecture / steps

1. `src/lib/dca.ts` — pure, unit-tested: `simulateDca(price, weights, budget,
   model)` → timeline (spent, BTC, basis, value) + summary stats; the
   `DcaMetric` interface + a registry; naive baseline = constant weights.
2. Metric adapters (one per driver above), each declaring its knobs.
3. `src/components/DcaExplorer.vue` — new tab: metric picker → generic knob
   sliders → spending-model toggle → results (value-over-time overlay vs naive,
   stats table). Reuses `useBitcoinData` + the cached `mwHeat` result.
4. Tests: known price path + weights ⇒ known ROI; assert every driver is causal
   (decision at `i` unchanged by mutating `price[>i]`).

### Stretch

- Auto-scan a knob for the ROI-maximising value (and show the curve).
- Fees/slippage; lump-sum-at-start benchmark; weekly vs daily cadence.
- Risk-adjusted scoring (Sharpe, max drawdown) so "more ROI" isn't the only win.
- Forward-return analysis: avg N-day return after deep-oversold vs neutral vs
  deep-overbought entries, to validate a driver before backtesting it.

## Housekeeping / ideas

- [ ] Add a CI build + type-check gate on PRs (a broken-build commit reached
      history on the forecast-tab branch because nothing ran `npm run build`).
