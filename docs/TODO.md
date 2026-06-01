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

## Next branch

### 1. Clearer model-selection naming

The top-row selectors and their dropdown options use jargon ("Envelope") that
doesn't convey meaning. Rework labels + option names to be self-explanatory.

- [ ] **"Envelope"** → a clearer name. It's the volatility multiplier on top of
      the value baseline (how far above the baseline price can swing), so
      something like "Volatility above baseline" / "Volatility decay". Rename
      the option names too:
  - `Time exp-decay`, `Value power-decay`, `Value exp-decay`, `Constant` —
    make these describe behavior (e.g. "Shrinks over time", "Shrinks as price
    grows", "Fixed").
- [ ] **"Value growth"** → confirm/clarify (e.g. "Baseline growth model"); the
      options `Power-law / Exponential / Linear` are okay but review wording.
- [ ] **"Peaks"** → clarify (e.g. "Cycle-top bumps"); options `Cycle peaks /
      None`.
- [ ] **"Horizon"** → clarify it's the projection end year (e.g. "Project
      until").
- [ ] Keep the underlying type values (`exponential-decay`, etc.) unchanged —
      only change display labels — to avoid touching the engine/config.

### 2. Linear slope as nth-percentile over a past D-day window

Replace the fixed slope-variant set (min/median/mean/max) with a tunable
"nth-percentile slope over the past D days" control for the linear growth model.

- [ ] Add inputs: **percentile** (0–100) and **lookback window D (days)**.
- [ ] Compute the rolling MA slopes (existing `rollingSlopes`) but only over the
      last D days of history, then take the chosen percentile as the linear
      rate.
- [ ] Decide how this interacts with the current `SlopeVariant` /
      `slopeStats` API in `src/lib/forecast.ts` — likely generalize
      `slopeStats` to a percentile function, or add a `slopePercentile(p, D)`
      helper, and have `resetToFit` use it.
- [ ] Update the linear-growth UI (currently the "Slope variant" dropdown) to
      the percentile + window inputs, and refresh `p.linRate` accordingly.

## Housekeeping / ideas

- [ ] Add a CI build + type-check gate on PRs (a broken-build commit reached
      history on the forecast-tab branch because nothing ran `npm run build`).
