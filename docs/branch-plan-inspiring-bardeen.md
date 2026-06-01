# Forecast tab — branch plan: `claude/inspiring-bardeen-lHExI`

Working scratch list for this branch. Delete (or fold into docs/TODO.md) before
merge.

## 1. Restructure the price-mechanics input panel

Make the controls intuitive by separating the two fundamentally different kinds
of knobs, with clearer labels and grouping.

- [x] **Group A — Calibration / fitting controls.** Moved MA window, Fit
      window, Day zero, Fit weighting γ (and the "Reset to fit" button) into a
      dedicated, violet-tinted "Calibration" section, set apart from the manual
      params. A note spells out that changing any knob re-fits and overwrites
      the parameter boxes below.
- [x] **Group B — Model-behavior parameters.** Growth (now under "Value
      baseline — growth") and envelope/peaks sections are now purely the
      hand-tunable outputs, tagged "auto-filled · editable" vs "manual".
- [x] Relabel for clarity: "Recency weighting γ", "Day zero (t₀)", "Baseline MA
      window", "Growth fit window"; γ help text folded into the calibration note.
- [x] Sanity pass: build + type-check pass; `resetToFit` and per-growth-type
      toggles still work after regrouping.

## 2. Cosmetic: envelope band around the projection (cosmetic)

Render the model's plausible range as a shaded band on the chart:

- [x] **Upper envelope** = `modelMa × envelope` (volatility multiplier applied
      to the value baseline) — the ceiling of the target range.
- [x] **Lower envelope** = `modelMa` (the blue value baseline) — the floor.
- [x] Shade the region between them (stacked area: invisible `lower` base +
      filled `upper − lower` diff) so the projection sits inside a cone that
      widens with volatility and narrows as the envelope decays.
  - Done on the **Price tab only** via a new optional `band` prop on
    `ForecastChart`. Band series are excluded from legend, tooltip, and the
    y-axis `bounds` calc, so observed price still drives the y-range.
  - Low-opacity blue fill (0.14) so it reads as context, not a 4th line.

## Housekeeping before merge

- [ ] Fold completed items into `docs/TODO.md` and remove this temp file.
- [ ] Consider adding a CI build/type-check gate on PRs (a broken-build commit
      reached history last branch because nothing ran `npm run build` on the PR).
