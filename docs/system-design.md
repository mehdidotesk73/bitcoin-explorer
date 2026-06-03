# System Design — Developer Documentation

A living map of how this app is built: data flow, the pure-logic libraries, the
per-feature designs, and the cross-cutting conventions. This is the **technical**
reference for developers and AI agents.

- For the **dev lifecycle** (branching, build gate, deploys), see `../CLAUDE.md`.
- For **user-facing** explanations of each page, see `concepts/*.md` (these are
  also rendered into the in-app Help modal).
- For **what's been tried / version history**, see `experience.md`.
- For the **backlog**, see `TODO.md`.

> **Status:** in progress. Many sections below are **placeholders** marked
> _TODO_; the Price Mechanics / forecast model is fully documented. Filling the
> placeholders is tracked in `TODO.md`.

---

## 1. System map

Vue 3 + TypeScript + Vite single-page app (also a PWA). The guiding rule:
**pure logic lives in `src/lib/` as plain functions over the already-fetched
arrays; components stay thin.** Everything is **causal** — a value for day `i`
uses only data at days ≤ `i`.

```
api/ (bitcoin.ts, supplemental.ts)
   └─► lib/useBitcoinData.ts   fetch + merge + localStorage cache
            │  raw: PricePoint[] { time, price }
            ▼
        App.vue  (tabs shell, shared header/help/PWA)
            │ raw passed to each tab
   ┌────────┼─────────────────────────────┐
   ▼        ▼                              ▼
PriceExplorer   ForecastView           HodlExplorer
 (+PriceChart,   (+ForecastChart)       (+StatsCompare)
  MetricsPanel)
            │
   shared pure lib + composables:
   indicators.ts · runs.ts · forecast.ts · hodl.ts · metricRegistry.ts
   format.ts · chartTheme.ts · period.ts · usePriceSeries.ts · useBandScore.ts
```

> _TODO: add a richer module-dependency diagram and call out the
> `echarts.connect` chart groups (`btc-explorer`, `btc-hodl`)._

---

## 2. Data layer

> _TODO. Document: `api/bitcoin.ts` (Binance daily closes, pagination/politeness),
> `api/supplemental.ts` (pre-2017 CoinMarketCap CSV, delimiter/column
> auto-detection, merge precedence), and `lib/useBitcoinData.ts` (localStorage
> cache `btc-daily-v1`, instant-then-refresh, offline fallback, `FetchProgress`).
> The shared shape is `PricePoint { time: epoch-ms UTC, price: USD close }`._

---

## 3. Shared libraries (`src/lib/`)

> _TODO. One subsection each:_
> - _`indicators.ts` — `sma`, `ema`, `bollinger`, `bandPosition` (the centered
>   "Bollinger score" band-position; see the formula in §5.1)._
> - _`runs.ts` — `scaleDiag(price, hd)`: causal EMA, rolling mean/std, OLS trend
>   operator, sustained-trend vote, run segmentation._
> - _`forecast.ts` — `fitParams` / `projectForecast` (spec in §5.2)._
> - _`hodl.ts` — seed combinator + `simulateStrategy` (spec in §5.3)._
> - _`metricRegistry.ts` — spec-driven Price-Explorer metrics + persistence._
> - _`format.ts`, `chartTheme.ts`, `period.ts` — shared formatters, ECharts
>   colour tokens, and period-unit helpers (`toDays`, `namedScaleLabel`)._

---

## 4. Composables

> _TODO. `usePriceSeries(raw)` → `{ prices, dates }`. `useBandScore(prices)` →
> the Bollinger-score state (Period/unit/σ/smoothing refs + labels + series);
> each call owns independent params, so the two tabs don't share tuning._

---

## 5. Features

### 5.1 Price Explorer

> _TODO. Metric-toggle framework (overlays: MA, Bollinger bands, run skeleton;
> curves: Price ÷ MA, Bollinger score, run slope), the run-scale slider +
> sensitivity, and the `metricRegistry` persistence/sharing. Note the Bollinger
> score is `bandPosition = (EMAₛ(price) − SMA_W)/(k·σ_W)`, centered (±1 = ±kσ
> bands), with independent Period/σ/Smoothing._

### 5.2 Price Mechanics — forecast model

The detailed spec behind the Price Mechanics tab (`lib/forecast.ts`:
`fitParams` / `projectForecast`). Distilled from the
[`bitcoin-model`](https://github.com/mehdidotesk73/bitcoin-model) repo. The
concise user-facing version is in `concepts/price-mechanics.md`.

#### Central idea: price = value × volatility

Every forecast is the product of two independently-modeled pieces:

$$
P_{\text{forecast}}(t) \;=\; \underbrace{\text{MA}_{\text{model}}(t)}_{\text{value baseline}}
\;\times\;
\underbrace{\left(\tfrac{P}{\text{MA}}\right)_{\text{model}}(t)}_{\text{volatility multiplier}}
$$

- **Value baseline** — a smooth, slowly-growing curve standing in for Bitcoin's
  "intrinsic value," anchored to a **4-year (1,460-day) moving average** of the
  close.
- **Volatility multiplier** — the ratio of actual price to that MA. Oscillates
  around `1.0`: above 1 at bull tops, below 1 in bear bottoms.

The two are modeled separately and multiplied back together — the core design
decision. The 4-year window is tied to Bitcoin's ~4-year halving cycle: long
enough to average out a full boom/bust, leaving the long-term value trend.

#### Basic metrics (data prep)

Computed from historical daily closes:

| Metric | Definition | Notes |
|--------|------------|-------|
| `close` | Daily closing price | exchange/API + static backfill |
| `ma_close` | Trailing **1,460-day** mean of `close` | the value baseline |
| `close_over_ma` | `close / ma_close` | observed volatility multiplier |
| `log_ma_close` | `ln(ma_close)` | for log-space curve fitting |

A time-based (calendar-day) trailing window is used, so data gaps don't distort
the average; early dates have a partial/undefined MA until 1,460 days accrue.

#### Value-growth models (projecting the MA forward)

Historical `ma_close` only exists up to today; to forecast, the MA is
**extrapolated**. Three forms, `x = days since day_zero (2010-07-13)`:

- **Exponential** — $\text{MA}(x) = C\,e^{\alpha x}$. Perpetual accelerating
  growth (`C ≈ 12.457`, `α ≈ 0.0016240`). Most aggressive.
- **Power-law** — $\text{MA}(x) = C\,(x+1)^{\beta}$. Decelerating; straight on a
  log-log plot (`C ≈ 2.063×10⁻¹⁴`, `β ≈ 4.914`). Preferred / most defensible.
- **Linear** — $\text{MA}(t) = \text{MA}_{\text{last}} + r\cdot\Delta t$. Continues
  from the last real MA at a constant slope `r` (per day), taken as an
  Nth-percentile of the trailing 365-day MA slopes (see Slope statistics).

Growth is fit in **log-space** (exp/power become linear regressions), robust to
price's huge dynamic range. Calibration eras differ per model. These are
extrapolations — small parameter changes → order-of-magnitude differences by 2050.

#### Volatility envelope (how big swings are)

The amplitude of the multiplier — how far above the MA price can spike at a top —
and how it **shrinks over time** as the market matures:

- **Time-based exp decay (primary)** — $1 + C\,e^{-\lambda x}$
  (`C ≈ 48.77`, `λ ≈ 0.000511`). Early tops overshot ~49×; each cycle less.
- **Value-based power decay** — $1 + C/\text{MA}^{p}$ (`C=1000`, `p=0.6`).
- **Value-based (stretched) exp decay** — $1 + C\,e^{-\lambda\,\text{MA}^{p}}$
  (`C=50`, `λ=0.245`, `p=0.245`).
- **Constant** — a fixed multiplier, no decay.

The envelope is calibrated **only against historical peak days** (it traces the
*tops* of `close_over_ma`, not the average). Premise: volatility monotonically
decreases as Bitcoin matures (by time or value).

#### Volatility distribution (when swings happen)

The envelope sets *how big* a peak can be; the distribution places peaks *in
time* as a sum of localized spikes:

$$
\left(\tfrac{P}{\text{MA}}\right)_{\text{model}}(x)
= 1 + \big(\text{envelope}(x) - 1\big)\cdot \sum_i e^{-s_i\,\lvert x - d_i\rvert}
$$

- `d_i` = peak dates; `s_i` = spread/width (≈ `0.008` calibrated).
- Historical tops: **2013-11, 2017-12, 2021-03**. Projected: **2025-07, 2029-07,
  2033-01, 2039-09** (~4-year spacing).
- **Naming note:** the params call these "Gaussian peaks," but the kernel is an
  **exponential/Laplacian** `exp(-s·|x − d|)` (a sharp tent), not a true Gaussian.
- `"none"` skips peaks and uses the bare envelope.

Future tops are an **input assumption** (halving rhythm), not data-derived;
between peaks the multiplier relaxes toward `1.0`.

#### Slope statistics (for the linear models)

At each date `t`, fit a degree-1 line to `(model_day, ma_close)` over the
trailing 365 days; keep the slope. From the full slope history, take an
Nth-percentile (range/window/percentile are tunable) as the per-day rate `r`.

#### Calibration

Parameters are **fit to history**, not hand-tuned:
- **Optimizer:** `scipy.optimize.minimize` (L-BFGS-B, bounded).
- **Objective:** weighted MSE $= \operatorname{mean}((y_{\text{actual}} - y_{\text{pred}})^2 w)$.
- **MA growth fits** in log-space (`ln(MA) = ln C + α·x` or `+ β·ln(x+1)`), then
  `C = exp(ln C)`. **Envelope fits** use only historical peak days.
- Diagnostics: R², max/mean abs residual, MSE improvement, parameter deltas.

#### End-to-end pipeline

```
Historical closes
   └─► 1,460-day MA  ──────────────┐  (value baseline)
   └─► close / MA  ────────────────┤  (observed volatility, fit targets)
[calibrate] fit growth + envelope params to history
Build future date grid (→ 2050, weekly)
   ├─ value growth → model_ma     (exp / power / linear)
   ├─ envelope     → peak amplitude vs t or value
   └─ distribution → place peaks at cycle dates
   model_price_over_ma = 1 + (envelope − 1) · Σ peaks
   projected_price = model_ma × model_price_over_ma
   └─► multi-panel (linear & log) charts: Price / Baseline / Ratio / Volatility
```

Each {growth} × {envelope} × {distribution} is one **scenario**; a run produces
several, together representing uncertainty — there is **no** probabilistic band.

#### Key assumptions

1. **Value = 4-year MA.** 2. **Separability** of growth and volatility.
3. **Volatility decays** as the asset matures. 4. **Cyclicality** — tops on a
~4-year halving cadence at pre-specified dates. 5. **History is representative.**
6. **Scenarios, not probabilities.**

#### Honest limitations

Pure heuristic curve-fitting — no error distribution or out-of-sample validation.
The power-law's extreme exponents make long-horizon output wildly sensitive to
small parameter changes. Future peak dates and the decay premise are assumptions
baked into parameters, not emergent. Treat the output as a **structured what-if
engine**, not a predictor.

### 5.3 Hodl Explorer

> _TODO. Seed-layer combinator (`lib/hodl.ts`): drivers (price ÷ MA band,
> Bollinger-score band, uniform spacing, manual) → frozen layers unioned into a
> strategy; trailing/range comparison window; shared budget; strategy- and
> preview-vs-baseline stats; Buy/Hodl indicator; `simulateStrategy` math
> (ROI / cost basis / coverage). Charts x-synced via a shared zoom model._

---

## 6. Charting conventions (ECharts)

> _TODO. `echarts/core` + explicit `echarts.use([...])`; per-point `itemStyle`
> instead of `visualMap`/segment colour on a category axis; synced crosshair +
> x-zoom via `echarts.connect(group)` and (in Hodl) an explicit shared `zoom`
> model. Colour tokens in `lib/chartTheme.ts`._

---

## 7. State, persistence & sharing

> _TODO. `metricRegistry` enabled-metrics + params via localStorage / URL;
> per-tab independent tuning (MA window, Bollinger-score params); PWA
> service-worker cache + "Reload latest"._

---

## 8. Build, deploy, CI & testing

> _TODO. `npm run build` (vue-tsc + vite) is the gate; CI (`.github/workflows/ci.yml`)
> runs `npm ci` → `test:run` → `build` on PRs; Vitest unit tests over `src/lib`
> (tests excluded from the app type-check); GitHub Pages prod deploy + Netlify
> previews. See `CLAUDE.md` for the lifecycle and `TODO.md` for the DevOps backlog._

---

## 9. Glossary & conventions

> _TODO. Define: causal/trailing, band position vs %B, run / scale (`hd`),
> envelope vs distribution, seed layer, value baseline. Note the project-wide
> "heuristics, not advice" framing._
