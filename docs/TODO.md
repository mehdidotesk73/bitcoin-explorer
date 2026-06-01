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

- [x] **Heat-band DCA exploration** (Price Explorer). For every day t, look
      back X days and score a buy method: buy the days whose M/W heat is in the
      band [centre ± window], measure mean(price[t]/price[j]) over those days vs
      over all days in the window. The method **score** = average of method/
      uniform growth across all eval days (>1 beats uniform DCA); also reports
      beat-rate and coverage. Scoring over a finite X-day horizon (not to today)
      avoids a few ancient cheap days dominating. `dcaScore()` / `dcaSweep()` in
      `indicators.ts`; UI: look-back X (default 1460), band centre + window, and
      a sweep curve of score vs centre with a parity line + coverage shading.
- [x] **DCA "days like today" timeline** (Price Explorer). Per-day signal: for
      each day t the band auto-centres on that day's own heat (±window), and we
      plot the trailing-X-day growth multiple of those band-days (blue) vs all
      days (grey) over time — price[t] cancels, so it reduces to "were days like
      today cheaper than average," a real-time relative-value signal. Attractive
      stretches (blue ≥ grey) shaded green. `dcaTimeline()` in `indicators.ts`,
      `DcaTimelineChart.vue`. Note: empirically the broad-coverage edge is ~1.0×
      (parity); only near-zero-coverage bands show big scores (overfit).

## Next branch

- [ ] Stretch from the DCA work: forward-return analysis conditioned on heat at
      entry (avg N-day return after deep-blue vs neutral vs deep-red) to measure
      the signal's correlation directly rather than via the DCA proxy.

## Housekeeping / ideas

- [ ] Add a CI build + type-check gate on PRs (a broken-build commit reached
      history on the forecast-tab branch because nothing ran `npm run build`).
