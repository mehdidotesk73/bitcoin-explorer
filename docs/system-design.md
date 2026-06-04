# System Design — Developer Documentation

A living map of how this app is built: data flow, the pure-logic libraries, the
per-feature designs, and the cross-cutting conventions. This is the **technical**
reference for developers and AI agents.

- For the **dev lifecycle** (branching, build gate, deploys), see `../CLAUDE.md`.
- For **user-facing** explanations of each page, see `concepts/*.md` (these are
  also rendered into the in-app Help modal).
- For **what's been tried / version history**, see `experience.md`.
- For the **backlog**, see `TODO.md`.

> **Status:** in progress. The forecast model (§5.2) plus the
> lib/composable/persistence/build sections (§3, §4, §7, §8) are written; still
> **placeholder** stubs: §2 data layer, §5.1 Price Explorer, §5.3 Hodl Explorer,
> §6 charting, §9 glossary. Filling the rest is tracked in `TODO.md`.

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
   pure analytics:   indicators.ts · runs.ts · forecast.ts · hodl.ts
   shared helpers:   format.ts · chartTheme.ts · period.ts · glossary.ts
   composables:      usePriceSeries.ts · useBandScore.ts · useBitcoinData.ts
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

All pure, framework-free functions over the already-fetched arrays — they
recompute instantly with no refetch, and every signal is **causal** (a value for
day `i` uses only data at days ≤ `i`).

**`indicators.ts`** — the core technical indicators:
- `sma(values, period)` — trailing simple moving average; the first `period − 1`
  entries are `null` so the output aligns 1:1 with the input.
- `ema(values, span)` — causal exponential MA, seeded with the first value;
  `span ≤ 1` is a no-op (the smoothing coefficient becomes 1).
- `bollinger(values, period, k)` → `{ middle, upper, lower }` — a `period`-SMA
  middle band with ±`k`·(population σ) bands.
- `bandPosition(values, smoothSpan, window, k)` — the centered **Bollinger
  score**: `b = (EMAₛ(price) − SMA_W) / (k·σ_W)`, `0` on the mean, `±1` on the
  ±kσ bands (so `b = 2·%B − 1`); `null` until the window warms up or when σ = 0.

**`runs.ts`** — sustained-run detection at one continuously-tunable scale `hd`
(days). `scaleDiag(price, hd, params?)` → `ScaleDiag { hd, ma, smoothed, b,
vote, runs }`. Every window scales from `hd` via `RunParams` (N/α/β/γ). Pipeline:
causal EMA of price (`smoothed`, span α·hd) → trailing mean/σ over the band
window N·hd → band position `b` → an OLS log-price **trend operator**
`τ = sign(slope)·r²·min(|slope|/scale, 1)` over β·hd → a **vote** = share of
up-days (τ > 0) over γ·hd, mapped to [−1, 1] → `segmentRuns` cuts maximal
stretches that clear `sustThresh` in one direction; sub-threshold (choppy) days
break runs. `k = N/10`, and σ is floored at `sigmaFloorFrac`·(mean price).

**`forecast.ts`** — the Price Mechanics fit/projection engine (`fitParams` /
`projectForecast`). Full spec in **§5.2**.

**`hodl.ts`** — the Hodl Explorer seed combinator + simulator. Full spec in
**§5.3**; key exports: `unionIndices`, `snapDateToIndex`, `uniformSpacedDates`,
`ratioSeries`, `windowIndices`, `selectBandBuyDates`, `simulateStrategy`.

**Helpers (single source of truth):**
- `format.ts` — `fmtUSD` (cents under $10, whole dollars above), `fmtPct`,
  `fmtBtc`; all return an em-dash for `null`.
- `chartTheme.ts` — shared ECharts colour tokens (`AXIS`, `SPLIT`, `ORANGE`,
  `BLUE`, `PURPLE`, `AMBER`, the run/direction `UP`/`DOWN`/`UP_RUN`/`DOWN_RUN`,
  and `BAND_FILL`).
- `period.ts` — period-unit helpers: `toDays(period, unit)`, `UNIT_ABBR`, and
  `namedScaleLabel(days)` (snaps a day-count to the nearest named horizon —
  daily…multi-year — by log-distance).
- `glossary.ts` — the `GLOSSARY` map (term → 1–3-sentence plain-English `def`)
  powering the beginner `InfoTip` tooltips.

> **Note:** there is **no** `metricRegistry.ts` on `main` — the spec-driven
> registry was prototyped on a branch but never merged. See §7 and
> `experience.md` ("Metric registry … never merged").

---

## 4. Composables

Vue composables wrapping reactive state/derivation; like the libs they stay thin
and recompute over the shared arrays.

- **`usePriceSeries(raw)`** → `{ prices, dates }` — splits the raw
  `PricePoint[]` into aligned number / ISO-date arrays (accepts a ref or getter).
  The companion `toDateInput(ms)` gives the `YYYY-MM-DD` (UTC) label.
- **`useBandScore(prices)`** → the Bollinger-score state: `smooth` / `period` /
  `unit` / `k` refs, the derived `windowDays`, `label` / `smoothLabel`, and the
  `series` (a `bandPosition` call). **Each call owns its own params**, so the
  Price Explorer curve and the Hodl `bscore` driver tune independently. Defaults
  reproduce the canonical look: 20 months · 2σ · 31-day EMA.
- **`useBitcoinData()`** — the shared data loader (detailed in §2): shows the
  cache instantly then refreshes in the background, exposed once and handed to
  every tab so the full daily series is fetched only once.

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

- **Price-data cache.** `useBitcoinData` writes the merged series to
  `localStorage["btc-daily-v1"]` as `{ points, ts }`. On load it shows the cache
  instantly (also works offline) then refreshes in the background; `lastUpdated`
  drives the footer "updated" stamp.
- **PWA / app shell.** `vite-plugin-pwa` (Workbox `generateSW`) precaches the
  built assets; `src/pwa.ts` registers the service worker, polls for a new deploy
  every 60 s, auto-reloads on a new build, and exposes the footer **Reload
  latest** button. See `CLAUDE.md` for the stale-cache caveat.
- **Per-tab tuning is independent.** `useBandScore` (and the per-tab long-MA
  refs) give each tab its own params — nothing is shared implicitly between the
  Price Explorer and Hodl Explorer.
- **No metric persistence or URL sharing.** The Price Explorer's metric toggles
  (`showMa`, `showBb`, …) and their per-metric configs are plain in-memory `ref`s
  in `PriceExplorer.vue`; they reset on reload and aren't encoded in the URL. A
  spec-driven registry with localStorage/URL persistence was prototyped but
  **never merged** (see `experience.md`, and the backlog note in `TODO.md` →
  Later / ideas).

---

## 8. Build, deploy, CI & testing

- **Build gate.** `npm run build` = `vue-tsc -b && vite build` — catches TS
  errors *and* Vue template parse errors. This is the bar before every commit;
  since the price API is unreachable from the sandbox, it's also the main offline
  check.
- **Scripts** (`package.json`): `dev`, `build`, `preview`, `test` (Vitest watch),
  `test:run` (one-shot, used by CI), plus `generate-pwa-assets` and the Capacitor
  `cap:*` helpers.
- **CI.** `.github/workflows/ci.yml` runs on PR → `main` and push → `main`:
  `npm ci` → `npm run test:run` → `npm run build`. Node 22 + npm cache (matches
  `deploy.yml`); `concurrency` cancels superseded runs. *Still manual: mark the
  `build` check **required** in branch protection so red PRs can't merge.*
- **Tests.** Vitest over `src/lib/*.test.ts` (`hodl.test.ts`,
  `indicators.test.ts`): hodl ROI / cost-basis + the band-date selectors, and
  `sma`/`ema`/`bollinger`/`bandPosition` including a **causality** assertion
  (mutating `price[>i]` mustn't change `b` at `i`). Tests are excluded from the
  production type-check (`tsconfig.app.json`).
- **Deploy.** Production is **GitHub Pages** (`.github/workflows/deploy.yml`, on
  push → `main`), which bakes `BASE_PATH=/<repo>/` into the asset paths (a repo
  rename needs a fresh deploy). **Netlify** builds per-PR/branch **preview**
  deploys (`netlify.toml`).
- **Known gaps** (tracked in `TODO.md` → DevOps): no ESLint/Prettier, no
  `.nvmrc`/`engines` Node pin, no Dependabot, and no bundle-size guard (the main
  echarts chunk warns at > 500 kB).

---

## 9. Glossary & conventions

> _TODO. Define: causal/trailing, band position vs %B, run / scale (`hd`),
> envelope vs distribution, seed layer, value baseline. Note the project-wide
> "heuristics, not advice" framing._
