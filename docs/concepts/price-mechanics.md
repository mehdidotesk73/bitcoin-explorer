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

### Model selection
- **Growth projection:** time-based **power-law** (default), **exponential**, or
  **linear**.
- **Volatility projection:** value/time **decay** variants (default: value-based
  exponential decay) or **constant**.
- **Cycle peaks:** **Laplacian** bumps at chosen peak dates, or none.
- **Horizon:** projection end year (2030 … 2050).
- **Log X / Log Y:** axis scaling for the charts.

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
  scenarios, not probabilities — there are no confidence bands. A what-if, not
  advice.

For the full equations, calibrated constants, and the fitting method behind this
tab, see §5.2 of the developer docs
([`docs/system-design.md`](../system-design.md)).
