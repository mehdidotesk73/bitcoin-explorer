# Bitcoin Forecast Model — Spec

The detailed reference for the **Price Mechanics** tab: the metrics it builds,
the assumptions it makes, and the equations that combine into a final price
forecast. Distilled from the
[`bitcoin-model`](https://github.com/mehdidotesk73/bitcoin-model) repository.

> **Status:** implemented. This is the math spec behind `lib/forecast.ts`
> (`fitParams` / `projectForecast`) and the Price Mechanics tab — the concise,
> user-facing overview lives in [`docs/concepts/price-mechanics.md`](concepts/price-mechanics.md).

---

## 1. The central idea: price = value × volatility

Every forecast in the model is the product of two independently-modeled pieces:

$$
P_{\text{forecast}}(t) \;=\; \underbrace{\text{MA}_{\text{model}}(t)}_{\text{value baseline}}
\;\times\;
\underbrace{\left(\tfrac{P}{\text{MA}}\right)_{\text{model}}(t)}_{\text{volatility multiplier}}
$$

- **Value baseline** — a smooth, slowly-growing curve standing in for Bitcoin's
  "intrinsic value." It is anchored to a **4-year (1,460-day) moving average** of
  the close price.
- **Volatility multiplier** — the ratio of actual price to that moving average.
  It oscillates around `1.0`: above 1 during bull-market tops, below 1 in
  bear-market bottoms.

The two are modeled separately and then multiplied back together. This
separation is the core design decision of the whole model.

### Why a 4-year window?
The 4-year MA is deliberately tied to Bitcoin's ~4-year halving cycle. It is long
enough to average out a full boom/bust cycle, leaving a curve that represents the
long-term value trend rather than short-term price action.

---

## 2. Basic metrics (Layer 1: data preparation)

Computed directly from historical daily closes:

| Metric | Definition | Notes |
|--------|------------|-------|
| `close` | Daily closing price | Source: exchange/API + static backfill |
| `ma_close` | Trailing **1,460-day** mean of `close` | The value baseline |
| `close_over_ma` | `close / ma_close` | The observed volatility multiplier |
| `log_ma_close` | `ln(ma_close)` | Used for log-space curve fitting |

**Assumptions in this layer**
- A time-based (calendar-day) rolling window is used, so gaps in data don't
  distort the average.
- The MA is *trailing* (uses only past data), so early dates have a partial /
  undefined MA until 1,460 days of history accumulate.

---

## 3. Value-growth models (Layer 3: projecting the MA forward)

Historical `ma_close` only exists up to today. To forecast, the MA must be
**extrapolated** into the future. Three functional forms are offered, where
`x = days since day_zero` (day_zero = `2010-07-13`):

### 3a. Exponential growth
$$\text{MA}(x) = C \cdot e^{\alpha x}$$
- Implies **perpetual accelerating** compound growth.
- Calibrated values: `C ≈ 12.457`, `α ≈ 0.0016240`.
- Most aggressive long-run scenario.

### 3b. Power-law growth
$$\text{MA}(x) = C \cdot (x+1)^{\beta}$$
- Implies **decelerating** growth (adoption S-curve-like), straight line on a
  log-log plot.
- Calibrated values: `C ≈ 2.063×10⁻¹⁴`, `β ≈ 4.914`.
- Generally treated as the **preferred / most defensible** scenario.

### 3c. Linear growth
$$\text{MA}(t) = \text{MA}_{\text{last}} + r \cdot \Delta t$$
- Continues from the last real MA value at a constant slope `r` (per day).
- Four variants use the **min / max / median / mean** of the historical
  365-day MA slopes (see §6), bracketing a plausible range.

**Assumptions**
- Growth is fit in **log-space** (so exponential/power become linear
  regressions), which is robust to the huge dynamic range of price.
- Different calibration eras are used per model (e.g. power-law fit from
  ~2013-05 onward) — the early, thinly-traded years can be excluded.
- These curves are **extrapolations**: small parameter changes produce
  order-of-magnitude differences by 2050.

---

## 4. Volatility envelope (Layer 1 of volatility: how big swings are)

The envelope describes the **amplitude** of the volatility multiplier — how far
above the MA price can spike at a cycle top — and how that amplitude **shrinks
over time** as the market matures.

### 4a. Time-based exponential decay (primary)
$$\text{envelope}(x) = 1 + C \cdot e^{-\lambda x}$$
- `x` = days since `2010-07-13`.
- Calibrated: `C ≈ 48.77`, `λ ≈ 0.000511`.
- Reads as: early tops overshot the MA by up to ~49×; each cycle overshoots
  less.

### 4b. Value-based power decay (alternative)
$$\text{envelope} = 1 + \frac{C}{\text{MA}^{\,p}}$$
- Volatility shrinks as a function of **valuation** rather than time.
- Example params: `C = 1000`, `p = 0.6`.

### 4c. Value-based (stretched) exponential decay (alternative)
$$\text{envelope} = 1 + C \cdot e^{-\lambda \cdot \text{MA}^{p}}$$
- Example params: `C = 50`, `λ = 0.245`, `p = 0.245`.

### 4d. Constant (degenerate)
$$\text{envelope} = \text{value}$$ — a fixed multiplier, no decay.

**Assumptions**
- Volatility **monotonically decreases** as Bitcoin matures (by time or by
  value). This is the key behavioral premise.
- The envelope is calibrated **only against historical peak days**, since it is
  meant to trace the *tops* of the `close_over_ma` ratio, not its average.

---

## 5. Volatility distribution (Layer 2 of volatility: when swings happen)

The envelope sets *how big* a peak can be; the distribution places peaks *in
time*. Peaks are modeled as a sum of localized spikes:

$$
\left(\tfrac{P}{\text{MA}}\right)_{\text{model}}(x)
= 1 + \big(\text{envelope}(x) - 1\big)\cdot \sum_i e^{-s_i\,\lvert x - d_i\rvert}
$$

- `d_i` = peak (cycle-top) dates; `s_i` = spread/width of each peak.
- Historical tops: **2013-11**, **2017-12**, **2021-03**.
- Projected future tops: **2025-07, 2029-07, 2033-01, 2039-09** (~4-year spacing).
- Each spread ≈ `0.008` in the calibrated config.

> **Naming note:** the parameters call these "Gaussian peaks," but the
> implementation uses an **exponential/Laplacian kernel** `exp(-s·|x − d|)`
> (a sharp tent), **not** a true Gaussian `exp(-s·(x − d)²)`. Worth deciding
> which we want when we implement.

The `"none"` distribution option skips peaks entirely and uses the bare
envelope.

**Assumptions**
- Future bull-market tops recur on a **~4-year halving rhythm** at the
  pre-specified dates above. These dates are an **input assumption**, not
  data-derived.
- Between peaks, the multiplier relaxes toward `1.0` (price ≈ its 4-year MA).

---

## 6. Slope statistics (supporting the linear models)

For the linear value-growth variants, the model computes a rolling **365-day
slope** of `ma_close` at every date — effectively the local growth rate of the
value baseline:

- At each date `t`, fit a line (`np.polyfit`, degree 1) to `(model_day, ma_close)`
  points within the trailing 365 days; keep the slope.
- From the full history of slopes, extract **min / max / median / mean**.
- These four numbers become the `r` (per-day rate) for the four linear
  scenarios in §3c.

---

## 7. Calibration (how parameters are fit)

Parameters above are **not hand-tuned** — they're fit to history.

- **Optimizer:** `scipy.optimize.minimize` with **L-BFGS-B** (bounded
  quasi-Newton).
- **Objective:** weighted mean squared error,
  $\text{MSE} = \operatorname{mean}\big((y_{\text{actual}} - y_{\text{pred}})^2 \cdot w\big)$.
- **MA growth fits** are done in **log-space**:
  - Exponential: `ln(MA) = ln(C) + α·x`
  - Power-law: `ln(MA) = ln(C) + β·ln(x + 1)`
  then `C` is recovered as `exp(ln C)`.
- **Envelope fits** use only the historical **peak days** as the target set.
- Reported diagnostics: **R²**, max/mean absolute residual, MSE improvement,
  and parameter deltas — used to sanity-check fit vs. overfit.

**Assumption:** history is representative of the future regime. Calibration
windows can be chosen per model to exclude eras deemed unrepresentative.

---

## 8. End-to-end pipeline

```
Historical closes
   └─► 1,460-day MA  ──────────────┐  (value baseline)
   └─► close / MA  ────────────────┤  (observed volatility, fit targets)
                                    │
[calibrate] fit growth + envelope params to history
                                    │
Build future date grid (→ 2050, every 5 days)
   ├─ Layer A: value growth   → model_ma           (exp / power / linear×4)
   ├─ Layer B: envelope       → peak amplitude vs t or value
   └─ Layer C: distribution   → place peaks at cycle dates
                                    │
   model_price_over_ma = 1 + (envelope − 1) · Σ peaks
                                    │
   projected_price = model_ma × model_price_over_ma
                                    │
   └─► CSV + interactive multi-panel (linear & log) charts
```

Each combination of {growth model} × {envelope model} × {distribution} is one
**scenario**. The standard run produces ~5+ scenarios (power, exponential, and
the four linear-slope variants), which together represent the forecast's
uncertainty — there is no probabilistic confidence band.

---

## 9. Key assumptions, gathered

1. **Value = 4-year MA.** Bitcoin has a definable "value" trajectory and it is
   the 1,460-day moving average.
2. **Separability.** Long-run value growth and short-run volatility can be
   modeled independently and multiplied.
3. **Volatility decays** monotonically as the asset matures (in time or value).
4. **Cyclicality.** Bull tops recur on a ~4-year halving cadence at
   pre-specified future dates.
5. **History is representative.** Curve fits on past data extrapolate to the
   future regime.
6. **Scenarios, not probabilities.** Uncertainty is expressed as a discrete set
   of growth/envelope choices, not as statistical confidence intervals.

---

## 10. User-adjustable controls (as implemented)

The Price Mechanics tab exposes these controls:

- **MA window** (default 1,460 days).
- **Value-growth model:** exponential / power-law / linear (min·max·median·mean).
- **Growth parameters:** `C`, `α`/`β`/`r`, `day_zero` — with calibrated
  defaults, optionally re-fit to the loaded data.
- **Envelope model:** time-exponential-decay / value-power-decay /
  value-exponential-decay / constant, with their parameters.
- **Peak distribution:** on/off, peak dates, spread; choice of Laplacian vs.
  true-Gaussian kernel.
- **Forecast horizon** (e.g. through 2030 / 2040 / 2050) and resolution.
- **Display:** overlay forecast scenarios on the existing price chart, linear
  vs. log y-axis, and a comparison of multiple scenarios at once.

---

## 11. Honest limitations

- Pure **heuristic curve-fitting**, not a stochastic/statistical forecast — no
  error distribution or out-of-sample validation.
- The power-law's extreme exponents (`β≈4.9`, `C≈10⁻¹⁴`) make long-horizon
  output **wildly sensitive** to small parameter changes.
- Future peak dates and the volatility-decay premise are **assumptions baked
  into parameters**, not emergent from data.
- The source repo's README itself cautions that Bitcoin "may exhibit
  fundamentally new dynamics," and that confidence degrades badly beyond ~10–20
  years.

Treat the output as a **structured what-if engine**, not a predictor.
