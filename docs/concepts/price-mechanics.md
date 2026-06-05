# Price Mechanics (Forecast)

A structured **what-if engine**. It does not predict; it lets you fit explicit
models to history and project them forward, so you can see what a given set of
assumptions implies for price out to a chosen year.

## Mental model

Decompose price into two independent pieces and recombine them:

```
price  ≈  value_baseline  ×  volatility_multiplier
```

- **Value baseline** — a slow ~4-year moving average standing in for "fair
  value." It grows over time (a **growth** model).
- **Volatility multiplier** — how far price swings above/below that baseline
  (price ÷ MA). It is shaped by a **volatility envelope** (typically decaying as
  the market matures) and, optionally, by **cycle peaks** on Bitcoin's ~4-year
  halving rhythm.

Projected price = modelled baseline × modelled multiplier, evaluated on a weekly
grid from the start of history to the horizon.

## Controls

The three parameter panels below the model pickers — **Calibration**, **Value
baseline — growth**, and **Volatility projection** — **start collapsed** so the
chart leads. Tap a panel's header to expand it (tap again to collapse).

### Model selection
- **Growth projection:** time-based **power-law** (default), **exponential**, or
  **linear**.
- **Volatility projection:** value/time **decay** variants (default: value-based
  exponential decay) or **constant**.
- **Cycle peaks:** **Laplacian** bumps at chosen peak dates, or none.
- **Horizon:** projection end year (2030 … 2050).
- **Band:** the **confidence level** (90 / 95 / 99) for the shaded *trend-line
  fan* — see below.
- **Log X / Log Y:** axis scaling for the charts.

### The trend-line fan (the shaded band)

The shaded band around the fitted curve is a **trend-line fan**. It is built by
re-fitting the model many times on resampled history and showing the spread of
those fits. The **Band %** picks how much of that spread to cover: a band at
**95%** spans the central 95% of the re-fits — i.e. 95 out of 100 re-fits land
inside it at each point. A higher % is wider.

**What it does *not* mean:** it is *not* a forecast of how far price can swing.
It measures only **how well the fitted line is pinned down** ("the fit could have
landed slightly higher or lower, and those alternatives diverge long-term"). For
Bitcoin the fit is tightly constrained by history, so **this band is genuinely
narrow** — do not read it as a future-variance / price-range forecast. The
wide "where could price actually be" cone (day-to-day volatility) is a separate
piece not yet built.

### Calibration (drives the auto-fit)
Changing anything here re-fits the model:
- **Baseline MA window** (default 1460 d / 4 yr) — the "value" definition.
- **Growth fit window** — how much trailing history the growth fit sees (0 = all).
- **Day zero (t₀)** — the time origin for power/exponential models.
- **Recency weighting γ** (power fit) — γ=0 weights all samples equally; higher γ
  favours recent cycles.
- **Reset to fit** — pull the freshly fitted values into the editable params.

### Hand-tunable parameters
After fitting you can override the growth constants, the volatility envelope
constants, and the peak set (add / remove / move peak dates, and a **spread**
controlling peak width).

## How it works

- `fitParams()` (`lib/forecast.ts`) fits the growth curve by **OLS in log
  space** (so the huge dynamic range from cents to tens of thousands is handled),
  computes a linear-rate percentile for the linear model, and fits the volatility
  envelope to the historical peak regions. R² is reported per fit.
- `projectForecast()` walks the weekly grid: for each date it evaluates the
  chosen growth model → baseline, the chosen envelope → multiplier amplitude,
  applies the peak kernel `Σ e^(−spread·|x − dᵢ|)` if peaks are on, and multiplies
  to get projected price. Actual price/MA are interpolated onto the same grid.
- The trend-line fan comes from `fitEnsemble()` (`lib/fitCurve.ts`): it resamples
  history and re-fits many times (a block bootstrap for the value curve;
  leave-one-cycle-out for the few envelope peaks), then reads the chosen central
  quantile band per point.
- Four chart tabs compare model vs actuals: **Price** (with a shaded
  baseline→ceiling band), **Baseline**, **Ratio** (price ÷ MA, log), and
  **Volatility** (the envelope).

## Assumptions & caveats

- **The 4-year MA is an assumption of "value,"** not a measured truth. Early,
  thin history (2010–2012) can dominate or distort fits — use the fit window / γ
  to down-weight it.
- **Separability:** growth and volatility are modelled independently and
  multiplied; in reality they can correlate.
- **Volatility is assumed to decay** as the market matures. If it rises, the cone
  is too tight.
- **Cycle peaks are inputs, not emergent** — future peak dates are placed on the
  halving rhythm by hand; if the cycle shifts, they miss.
- **History is assumed representative.** All fits extrapolate the past regime;
  regulatory/macro/tech shocks break that.
- **R² measures historical fit, not forecast accuracy.** These are explicit
  scenarios, not probabilities. The one band that *is* shown — the trend-line fan
  — is **epistemic** (uncertainty in the fitted line) and deliberately narrow; it
  is **not** a future price-range band. A what-if, not advice.

For the full equations, calibrated constants, and the fitting method behind this
tab, see §5.2 of the developer docs
([`docs/system-design.md`](../system-design.md)).
