# Forecast tab — TODO

## In progress (current branch: `claude/forecast-tab`)

- [x] Interactive cycle-peak editor: move peak dates with sliders, add a peak,
      remove a peak, clear all peaks, and redistribute to the default tops.

## Next branch

- [ ] **Restructure the Price-mechanics input panel.** Make the controls more
      intuitive with clearer label naming and grouping. In particular, visually
      separate the two kinds of knobs:
  - **Fitting controls** — inputs that drive the automatic curve fit and
    silently overwrite the parameter boxes via `resetToFit` (MA window, Fit
    window, Day zero, Fit weighting γ). These behave like an implicit
    "Reset to fit" on every change and should be grouped/labelled as
    calibration knobs.
  - **Model-behavior parameters** — manual overrides that feed the projection
    directly and persist until the next refit (growth C/α/β, envelope
    constants, linear rate, peak spread, peak dates).
  - Consider labelling/affordances that make it obvious when editing a field
    will rewrite other fields, versus when it only nudges the projection.
