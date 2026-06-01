# Forecast tab — branch plan: `claude/inspiring-bardeen-lHExI`

Working scratch list for this branch. Delete (or fold into docs/TODO.md) before
merge.

## 1. Restructure the price-mechanics input panel

Make the controls intuitive by separating the two fundamentally different kinds
of knobs, with clearer labels and grouping.

- [ ] **Group A — Calibration / fitting controls.** Inputs that drive the
      automatic curve fit and silently overwrite the parameter boxes via
      `resetToFit`: MA window, Fit window, Day zero, Fit weighting γ.
  - Put them in a visually distinct "Calibration" group.
  - Make it obvious that changing one re-fits and rewrites the param boxes
    below (label, helper text, or an icon/affordance).
- [ ] **Group B — Model-behavior parameters.** Manual overrides that feed the
      projection directly and persist until the next refit: growth C/α/β,
      envelope constants, linear rate, peak spread, peak dates.
  - Group as "Model parameters"; clarify these are hand-tunable and survive
    until a recalibration stomps them.
- [ ] Rename labels for clarity (e.g. "Constant C" → name that says what it is
      per growth/envelope type; γ → "Recency weighting" or similar with a hint).
- [ ] Sanity pass: ensure tab/disabled/`resetToFit` behavior still works after
      regrouping.

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
