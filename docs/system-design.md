# System Design — Developer Documentation

A living map of how this app is built: data flow, the pure-logic libraries, the
per-feature designs, and the cross-cutting conventions. This is the **technical**
reference for developers and AI agents.

- For the **dev lifecycle** (branching, build gate, deploys), see `../CLAUDE.md`.
- For **user-facing** explanations of each page, see `concepts/*.md` (these are
  also rendered into the in-app Help modal).
- For **what's been tried / version history**, see `experience.md`.
- For the **backlog**, see `TODO.md`.

> **Status:** all sections are written (§1–§9). Keep them current as the code
> changes — the doc-checkpoint step in `CLAUDE.md` governs when.

---

## 1. System map

Vue 3 + TypeScript + Vite single-page app (also a PWA). The guiding rule:
**pure logic lives in `src/lib/` as plain functions over the already-fetched
arrays; components stay thin.** Everything is **causal** — a value for day `i`
uses only data at days ≤ `i`.

```
`data` branch: btc-daily.json ◄── nightly data-refresh.yml (scripts/update-btc-data.ts)
   │ bundled into each build (deploy.yml / netlify.toml)
api/ (snapshot.ts, bitcoin.ts, supplemental.ts)
   └─► lib/useBitcoinData.ts   snapshot + live top-up + localStorage cache
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
   shared helpers:   format.ts · chartTheme.ts · period.ts · glossary.ts ·
                     peaks.ts (cycle-peak schedule) · btcSnapshot.ts (data snapshot)
   composables:      usePriceSeries.ts · useBandScore.ts · useBitcoinData.ts
   shared UI:        Panel.vue (container) · InfoTip.vue (glossary tooltip) ·
                     WheelPicker.vue (unit wheel)
```

**Dependency direction.** `api/*` → `useBitcoinData` → `App.vue` → the three
tabs; each tab pulls pure logic from `lib/*` (and composables) but the libs
import **nothing** from components — the arrow only points one way. This is what
keeps logic testable in isolation (§8) and recomputable without a refetch.

**Chart sync groups.** Within a tab, ECharts `connect` groups keep **x-zoom** and
the **crosshair/tooltip** in lockstep: **`btc-explorer`** (Price Explorer's
`PriceChart` + one `MetricChart` per separate curve) and **`btc-hodl`** (Hodl
Explorer's price + driver-metric charts). The crosshair is the **native**
`axisPointer` mirrored by `connect` — no hand-drawn line. The shared
`lib/useChartSync.ts` composable wires the connect group, an idempotent zoom
bridge, and the pan/crosshair touch gesture; details and caveats are in §6.

---

## 2. Data layer

The whole app runs on one shape: **`PricePoint { time: epoch-ms UTC, price: USD
close }`**, one per UTC day. Two sources feed it, merged by `useBitcoinData`.

**`api/bitcoin.ts` — live Binance closes.** `fetchDailyPrices(startTime,
onProgress, signal)` pages the keyless, CORS-enabled `data-api.binance.vision`
klines endpoint (`BTCUSDT`, `1d`). The endpoint caps at 1000 bars/request, so it
**paginates**: advance the cursor to just past the last bar's open time until
caught up to now, `sleep(120 ms)` between pages to be polite, and report
`FetchProgress { bars, pages }` after each page. `BTCUSDT` only lists from
**2017-08-17** (`EARLIEST_MS`), hence the supplemental source for earlier years.

**`api/supplemental.ts` — pre-Binance backfill (optional).** `loadSupplemental()`
fetches a committed static CSV at `public/data/btc-pre-binance.csv` (e.g. a
CoinMarketCap export). `parseCsv` **auto-detects** the delimiter (`;` vs `,`) and
the date/close columns by header name (`timeClose`/`timestamp`/`timeOpen`/`date`
and `close`/`price`), with a quote-aware field splitter. If the file is absent or
unparseable it returns `[]` and the app **silently** runs Binance-only.

**`api/snapshot.ts` + `lib/btcSnapshot.ts` — the app-owned snapshot.** The full
daily history is data the app owns: `btc-daily.json`, a JSON array with **one day
per line** (`{"t":"YYYY-MM-DD","c":close}`) so each update is a few added lines.
It lives on a dedicated **`data` branch** (orphan — no `main` history, written
only by CI, never via PR), and every build copies it to `public/data/` (gitignored
on `main`). `btcSnapshot.ts` holds the pure rules shared by the app and the update
script: `mergeDaily(...lists)` (one point per UTC day, normalised to midnight;
**later lists win** overlaps), `completeDays` (today's still-moving close is never
stored), `topUpStart` (day after the snapshot ends), `nextSnapshot` (merge + throw
rather than **shrink** stored history), and `serializeSnapshot` / `parseSnapshot`
(malformed input → `[]`, e.g. an SPA `index.html` fallback). `loadSnapshot()`
fetches it with `cache: 'no-cache'`; it's deliberately **not** precached by the
service worker.

**The nightly pipeline.** `.github/workflows/data-refresh.yml` runs at 01:17 UTC
(after the 00:00 UTC daily close) and on **Run workflow**:
`scripts/update-btc-data.ts` (Node `--experimental-strip-types`, no deps — reuses
`api/bitcoin.ts` and `parseCsv`) reads the snapshot, fetches only the Binance days
after it, and rewrites it; on the first run it seeds from the CSV + full Binance
history. If anything changed it commits to `data` and **calls `deploy.yml`**
(`workflow_call` — a push made with the workflow token doesn't trigger other
workflows), so production picks up the new snapshot nightly with nobody merging.
`deploy.yml` fetches `data` to bundle the file; Netlify previews download it from
the raw `data` URL (`netlify.toml`, non-fatal) and never build the `data` branch
itself (`ignore`, plus branch deploys off in the Netlify UI). `deploy.yml` takes
`BASE_PATH` from `GITHUB_REPOSITORY`, because a scheduled run's event has no
`repository` payload.

**`lib/useBitcoinData.ts` — load, top up, cache.** `init()` shows the
`localStorage["btc-daily-v1"]` cache **instantly** (works offline), then
`refresh()` loads the snapshot, shows it at once, and fetches only the Binance
days from `topUpStart` (usually one request), merging with `mergeDaily`. **Without
a snapshot** (local dev, or before the first nightly run) it falls back to the CSV

- full Binance history. The result updates `raw` + `lastUpdated` and rewrites the
  cache. Errors surface in `error` and the on-screen debug log; a corrupt cache is
  ignored. The sandbox **can't reach** Binance (host allowlist), so data-dependent
  behaviour is device-validated.

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
- `period.ts` — period-unit helpers: `toDays(period, unit)`, `UNIT_ABBR`,
  `UNIT_OPTIONS` (the choices for the unit wheel pickers), and
  `namedScaleLabel(days)` (snaps a day-count to the nearest named horizon —
  daily…multi-year — by log-distance).
- `peaks.ts` — the cycle-peak **spacing schedule** behind the Price Mechanics
  peak editor (§5.2): `PeakSchedule { firstMs, pastGaps, projGaps }` (gaps in
  days; the first projected gap counts from the last past peak),
  `scheduleFromDates` / `scheduleDates` (dates ↔ schedule), `removeGap` (folds a
  removed peak's gap into the next so later peaks keep their dates),
  `uniformGaps` / `uniformGapsUntil`, `meanGap`, and the defaults
  `DEFAULT_PROJ_SPACING` (1460 d) / `DEFAULT_PROJ_UNTIL_MS` (end of 2040).
- `btcSnapshot.ts` — the app-owned daily-close snapshot format and merge rules
  (§2).
- `glossary.ts` — the `GLOSSARY` map (term → 1–3-sentence plain-English `def`)
  powering the beginner `InfoTip` tooltips. The `InfoTip` popover is a tap-to-
  toggle disclosure that clamps itself horizontally to the viewport on open
  (`getBoundingClientRect`), with `overflow-x: clip` on the root as a guard so a
  transiently-wide popover can't trigger mobile-Safari zoom.

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
- **`useChartSync({ chart, el, group?, getZoom?, onZoom?, pixelToIndex? })`** —
  the shared chart-interaction wiring (§6). Optionally joins a `connect` group,
  runs an idempotent zoom bridge (only when `getZoom`/`onZoom` are given), and
  installs the touch **pan/crosshair gesture**. Returns `{ attach }`, called once
  the chart is initialised. Used by `PriceChart`, `MetricChart`, `ForecastChart`
  (gesture only) and Hodl's two charts (gesture only).

---

## 5. Features

### 5.0 Shared UI components

The first abstractions of the UI component-framework initiative (see `TODO.md` →
_UI component framework_) live in `src/components/`:

- **`Panel.vue`** — the themed container behind the app's bordered "panel" boxes.
  Variation is prop-driven, not per-call CSS: `theme` (`default` | `violet`),
  `size` (`regular` | `compact`), `collapsible` (`none` | `header` | `face` |
  `icon`), and `v-model:collapsed`, plus `#header` / `#summary` / `#actions`
  slots. The accent tint is the `--accent-violet-tint` design token (`style.css`).
  Used by the Price Explorer **Metrics** menu (violet/compact/face), its **five
  metric cards** (compact/icon — the ⚙ is the Panel's built-in toggle), and the
  Price Mechanics **Calibration / Value-baseline-growth / Volatility** panels
  (header-tap). Slotted body content keeps each view's own scoped styles, so the
  controls inside are unchanged.
- **`InfoTip.vue`** — the glossary `?` tooltip (see §3): a tap-to-toggle popover,
  viewport-clamped on open with an `overflow-x: clip` root guard.
- **`WheelPicker.vue`** — a generic `v-model` vertical wheel (`options:
{ value, label }[]`), used for the days / weeks / months period units in the
  Price Explorer metric cards. Native scroll + `scroll-snap` does momentum and
  snapping; the centred row is emitted once scrolling settles. Closed it's one
  row tall, stretched to its flex row (the number input) and measured into
  `--slot`; while held or scrolling it bulges into a slightly taller drum drawn
  as an overlay. Only the drum's `clip-path` animates, so the scroll geometry is
  constant mid-gesture. Rows tilt/shrink/fade with distance from centre (a
  per-row `perspective()` transform — not a 3D context on the scroller, which is
  flaky in Safari). Scroll is y-only. Uses `click.prevent` because it sits inside
  a `<label>` whose default action would focus the neighbouring input.

`App.vue` also surfaces a top-bar **Update available** button (shown when
`useVersionCheck` reports `update-ready`) that opens a popover with the current
build, the new published commit, and the reload button — the footer's version
info, reachable without scrolling. See §7.

### 5.1 Price Explorer

`PriceExplorer.vue` owns the metric state and feeds two chart components.
Default view is **price only**; each metric toggles independently.

**Metric framework.** Metric on/off flags and their per-metric ⚙ configs are
plain in-memory `ref`s (`showMa`, `showBb`, `showRunDetection`, `showRatio`,
`showBand`; `cfg*`). They live in a single collapsible **Metrics** disclosure
(`menuCollapsed`, **default collapsed**; the header lists the active metrics when
folded and shows a tap-to-expand/collapse hint). Two kinds:

- **Overlays** (drawn on the price chart, `PriceChart.vue`): Moving average
  (`sma`), Bollinger bands (`bollinger`), and the **run skeleton** — a
  piecewise-linear line anchoring price at each run's start/end (`runOverlay`)
  with `connectNulls`, so each run renders at its average slope.
- **Separate curves** (`MetricsPanel.vue`, in a collapsible "Additional graphs"
  panel): **Price ÷ MA** on a log axis against an independent long baseline
  (`ratioMaDays`, default 1460), **Bollinger score** (`useBandScore`), and **Run
  slope** bars (per-run average daily %, coloured by direction). `MetricsPanel`
  is now pure "what to draw": it builds each active curve's series and renders
  one single-grid **`MetricChart.vue`** instance per curve (each joins the
  `btc-explorer` group), rather than one chart with stacked grids — so the native
  crosshair lines up across every figure.

**Run controls (shared).** Run detection, the run skeleton, and run slope share
one engine call: `scaleDiag(prices, runScaleDays, { N, sustThresh })`. The
**Scale** slider is _logarithmic_ — slider 0–100 maps to `hd ∈ [1, 1500]` days
(`tForHd`/`runScaleDays`) and the label snaps to the nearest named scale.
**Sensitivity** is presented inverted (`sensitivity = 0.9 − sustThresh`) so
higher = more/longer runs.

**Bollinger score.** `bandPosition = (EMAₛ(price) − SMA_W)/(k·σ_W)`, centered
(±1 = the ±kσ bands), with independent Period / σ / Smoothing — see §3
(`indicators.ts`) and §4 (`useBandScore`).

**Sync.** Every chart (the price chart + each `MetricChart`) joins the
`btc-explorer` connect group, so the **native crosshair/tooltip** and inside-zoom
mirror across all figures; the parent's `zoom` model (`v-model:zoom`) carries the
slider range + range presets via `useChartSync`'s zoom bridge (§6). There is
**no** persistence of toggles/params (§7).

### 5.2 Price Mechanics — forecast model

The detailed spec behind the Price Mechanics tab (`lib/forecast.ts`:
`fitParams` / `projectForecast`). Distilled from the
[`bitcoin-model`](https://github.com/mehdidotesk73/bitcoin-model) repo. The
concise user-facing version is in `concepts/price-mechanics.md`.

The three parameter panels (`ForecastView.vue`: **Calibration**, **Value
baseline — growth**, **Volatility projection**) are header-tap collapsible
(`calibCollapsed` / `growthCollapsed` / `volCollapsed`, **default collapsed**) so
the chart leads on a phone; each header carries a chevron + tap-to-expand/collapse
hint, mirroring the Price Explorer Metrics disclosure.

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

| Metric          | Definition                             | Notes                          |
| --------------- | -------------------------------------- | ------------------------------ |
| `close`         | Daily closing price                    | exchange/API + static backfill |
| `ma_close`      | Trailing **1,460-day** mean of `close` | the value baseline             |
| `close_over_ma` | `close / ma_close`                     | observed volatility multiplier |
| `log_ma_close`  | `ln(ma_close)`                         | for log-space curve fitting    |

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
_tops_ of `close_over_ma`, not the average). Premise: volatility monotonically
decreases as Bitcoin matures (by time or value).

#### Volatility distribution (when swings happen)

The envelope sets _how big_ a peak can be; the distribution places peaks _in
time_ as a sum of localized spikes:

$$
\left(\tfrac{P}{\text{MA}}\right)_{\text{model}}(x)
= 1 + \big(\text{envelope}(x) - 1\big)\cdot \sum_i e^{-s_i\,\lvert x - d_i\rvert}
$$

- `d_i` = peak dates; `s_i` = spread/width (≈ `0.008` calibrated).
- Defaults: past tops **2013-11-28, 2017-12-17, 2021-03-17, 2025-07-13**
  (`DEFAULT_PEAK_DATES`); projected tops every **1460 days** after the last past
  one through 2040 (2029-07-12, 2033-07-11, 2037-07-10).
- **Editor (`ForecastView` + `lib/peaks.ts`):** peaks are a spacing schedule, not
  absolute dates. **Past** and **projected** lists, each headed with its live
  average spacing. The first past peak is a date slider; every other peak is a
  typed `+ N days` gap with its derived date beside it. Projected peaks have a
  _Spaced N days_ + **Distribute uniformly** control (peak k = last past peak +
  k·N). Dates past the horizon are dimmed. The forecast only sees the derived
  date list.
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
2. **Volatility decays** as the asset matures. 4. **Cyclicality** — tops on a
   ~4-year halving cadence at pre-specified dates. 5. **History is representative.**
3. **Scenarios, not probabilities.**

#### Honest limitations

Pure heuristic curve-fitting — no error distribution or out-of-sample validation.
The power-law's extreme exponents make long-horizon output wildly sensitive to
small parameter changes. Future peak dates and the decay premise are assumptions
baked into parameters, not emergent. Treat the output as a **structured what-if
engine**, not a predictor.

### 5.3 Hodl Explorer

A buying-strategy sandbox: compose buy-day rules, then compare them against a
buy-every-day baseline over a shared budget. Logic is `lib/hodl.ts` (pure,
causal); `HodlExplorer.vue` is the UI + charts.

**Seed-layer combinator.** A strategy is the **union** of frozen _seed layers_
(`SeedLayer { id, kind, label, dateIndices }`). Each layer resolves to a static
set of day indices **once, when added**, and is frozen thereafter:

- **`ratio`** / **`bscore`** — `selectBandBuyDates(metric, band, candidates)`
  keeps days whose driver metric (`ratioSeries` price÷MA, or the Bollinger score)
  falls in a `Band { lower, upper }`.
- **`uniform`** — `uniformSpacedDates(n, everyX, offset, candidates)`: every
  `everyX` days on a phase anchored to today (offset shifts the weekday).
- **`manual`** — explicit dates, each `snapDateToIndex`'d to the nearest day.

`unionIndices` merges all layers into the final sorted buy set.

**Comparison window + simulation.** A trailing-days **or** from/to window
(`windowIndices`) is the shared arena: both the strategy and the buy-every-day
baseline buy only within it. `simulateStrategy(price, buyIndices, budget=1,
coverageDenom)` splits the budget equally across buy days, accumulates BTC at
each day's price, and returns `HodlStats` — `currentValue`, `roi`, `costBasis`,
`btcAccumulated`, `numBuys`, and `coverage` (numBuys / window size). Scale-free by
default (budget = 1 unit), so only ratios matter.

**UI surfaces.** `StatsCompare.vue` shows strategy-vs-baseline **and** a live
preview (the band you're dragging) vs baseline; a Buy/Hodl indicator card reads
each pattern's verdict for today. Out-of-window manual dates are flagged and
excluded. The price + driver-metric charts share the `btc-hodl` connect group
(native crosshair) plus an **explicit** shared `zoom` bridge that mirrors the
range _including the slider_ between the two charts (the metric chart has no
slider to match by index, so `connect` can't carry it — §6). `useChartSync`
supplies only the pan/crosshair gesture on each Hodl chart, not its zoom.

---

## 6. Charting conventions (ECharts)

- **Tree-shaken imports.** Use `echarts/core` + an explicit
  `echarts.use([...])` per component, registering every chart/component/renderer
  used (e.g. `LineChart`, `BarChart`, `GridComponent`, `TooltipComponent`,
  `DataZoomComponent`, `MarkLine/MarkArea`, `CanvasRenderer`). Forgetting one
  fails silently at runtime, not at build.
- **Category-axis colour gotcha.** On a category x-axis, `visualMap` and
  per-segment `lineStyle` colour do **not** bind. For per-point colour use a
  series with per-point `itemStyle` (see the run-slope bars in `MetricsPanel.vue`
  — each datum carries its own `{ value, itemStyle }`).
- **All-native crosshair + sync (`lib/useChartSync.ts`).** Every figure is a
  **single-grid** chart instance joined to a `connect` group (`btc-explorer` /
  `btc-hodl`). `connect` mirrors the **native** `axisPointer`/tooltip and the
  inside-zoom across the group — there is **no** hand-drawn crosshair and no
  `setOption` on pointer move (that earlier approach was the source of the jank;
  see `experience.md`). The composable owns: joining the group, the zoom bridge,
  and the touch gesture.
- **Zoom bridge.** `connect` syncs the inside action but **not** the slider
  range, and only matches dataZoom components **by index** — so a slider (index 1)
  doesn't reach a sibling that has only an inside zoom. Two shapes:
  - _Explorer_ (`PriceChart` + N `MetricChart`, separate components): the parent
    `zoom` `v-model` is the source of truth; each chart's `useChartSync` emits on
    `datazoom` and applies external changes (presets) via `dispatchAction`. A
    **per-group** suppress (shared across the connected charts) stops a
    programmatic dispatch and its `connect` echoes from feeding back.
  - _Hodl_ (two charts, one component): an **explicit** bridge in
    `HodlExplorer.vue` mirrors the range — including the slider — directly to the
    other chart on each `datazoom`, guarded by a shared `suppressZoom`. This is
    the proven setup for the index-mismatched price (inside+slider) / metric
    (inside) pair; `useChartSync` there supplies the gesture only.
- **Pan / crosshair gesture (touch).** Pan vs. crosshair is two native flags
  flipped per gesture: `dataZoom.inside.moveOnMouseMove` and `tooltip.triggerOn`.
  Drag = pan; long-press (~320 ms) then drag = crosshair (pan frozen, ECharts
  follows the finger); on release the crosshair stays put via a programmatic
  `showTip` until a pan or tap clears it; two-finger pinch always zooms. Touches
  starting outside the plot grid (slider/axis) are ignored so the slider keeps its
  native drag. Desktop is left fully native: hover = crosshair, drag = pan, wheel =
  zoom (gated by `matchMedia('(hover: none) and (pointer: coarse)')`).
- **Value/log x-axis.** The sticky read-out maps a pixel to a data index; on a
  category axis that's a rounded `convertFromPixel`, but a value/log axis
  (`ForecastChart`) passes a custom `pixelToIndex` that finds the nearest sample.
- **Theme.** Colours come from `lib/chartTheme.ts` tokens, never per-file literals.

---

## 7. State, persistence & sharing

- **Price-data cache.** `useBitcoinData` writes the merged series to
  `localStorage["btc-daily-v1"]` as `{ points, ts }`. On load it shows the cache
  instantly (also works offline) then refreshes in the background; `lastUpdated`
  drives the footer "updated" stamp.
- **PWA / app shell.** `vite-plugin-pwa` (Workbox `generateSW`) precaches the
  built assets; `src/pwa.ts` registers the service worker, polls for a new deploy
  every 60 s, auto-reloads on a new build, and exposes the footer **Reload
  latest** button. The polite skip-waiting path (`registration.update()` → wait
  for the new worker → `updateServiceWorker(true)` → reload) proved unreliable on
  **iOS Safari PWAs**: when `update()` doesn't actually swap in a new worker, the
  old SW keeps controlling the page and replays the _precached_ `index.html` +
  hashed bundle out of Cache Storage, so the reload lands on the same build. The
  button now **hard-resets** instead — since it only fires once `version.json` has
  confirmed a newer build is live: it unregisters every service worker, clears
  Cache Storage, and navigates with a `?fresh=<ts>` cache-buster so neither the SW
  precache nor the HTTP cache can replay the stale build. The SW re-registers and
  re-precaches on the next load; `main.ts` strips the `fresh` marker on boot. See
  `CLAUDE.md` for the stale-cache caveat, and `experience.md` for the dead-end.
- **Version freshness.** A build-time Vite plugin (`emit-version-json`) writes
  `version.json` (`{ commit, builtAt }`) into the build root, deliberately
  **outside** the Workbox precache. `lib/useVersionCheck.ts` fetches it
  cache-busted (`cache: 'no-store'`) every 60 s and compares the live origin's
  _published_ commit to the loaded `__BUILD_ID__`, so the footer can honestly
  show **Up to date** vs **Update ready** instead of silently reloading into the
  same build. (Phase 2 — a _built-vs-published_ "publishing…" state — is queued
  in `TODO.md`.) When the status is `update-ready`, `App.vue` also shows a top-bar
  **Update available** button (opposite Help) whose popover mirrors this footer
  info — build, new published commit, and the reload button — so the prompt is
  reachable without scrolling to the footer.
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
  errors _and_ Vue template parse errors. This is the bar before every commit;
  since the price API is unreachable from the sandbox, it's also the main offline
  check.
- **Scripts** (`package.json`): `dev`, `build`, `preview`, `test` (Vitest watch),
  `test:run` (one-shot, used by CI), plus `generate-pwa-assets` and the Capacitor
  `cap:*` helpers.
- **CI.** `.github/workflows/ci.yml` runs on PR → `main` and push → `main`:
  `npm ci` → `npm run format:check` → `npm run test:run` → `npm run build`. Node 22 + npm cache (matches
  `deploy.yml`); `concurrency` cancels superseded runs. _Still manual: mark the
  `build` check **required** in branch protection so red PRs can't merge._
- **Tests.** Vitest over `src/lib/*.test.ts`: `hodl.test.ts` (ROI / cost-basis
  - band-date selectors), `indicators.test.ts` (`sma`/`ema`/`bollinger`/
    `bandPosition`, incl. a **causality** assertion — mutating `price[>i]` mustn't
    change `b` at `i`), `btcSnapshot.test.ts` (merge precedence, today excluded,
    format round-trip, top-up start, no-shrink guard) and `peaks.test.ts`
    (schedule ↔ dates, `removeGap` keeps later dates, uniform spacing). Tests are excluded from the
    production type-check (`tsconfig.app.json`).
- **Deploy.** Production is **GitHub Pages** (`.github/workflows/deploy.yml`, on
  push → `main`, and nightly via `data-refresh.yml`), which bakes
  `BASE_PATH=/<repo>/` into the asset paths (a repo rename needs a fresh deploy)
  and bundles the `data`-branch snapshot (§2). **Netlify** builds per-PR
  **preview** deploys only (`netlify.toml`; branch deploys off).
- **Formatting.** Prettier config + scripts are committed (`.prettierrc.json` —
  no-semi / single-quote / 100-col; `format` / `format:check`), but the
  repo-wide format pass and the CI `format:check` gate are **not** done yet.
- **Known gaps** (tracked in `TODO.md` → DevOps): no ESLint, no `.nvmrc`/`engines`
  Node pin, no Dependabot, no bundle-size guard (the main echarts chunk warns at
  > 500 kB), and the format pass/gate above.

---

## 9. Glossary & conventions

Developer-facing terms (the beginner-facing definitions live in `lib/glossary.ts`
/ the Help modal).

- **Causal / trailing.** A value for day `i` uses only data at days ≤ `i`. Every
  indicator here is causal — no look-ahead. Tested by the causality assertion in
  `indicators.test.ts`.
- **Value baseline.** The slow 4-year (1,460-day) MA standing in for "intrinsic
  value" in the forecast (§5.2) and the Price ÷ MA curve's denominator (§5.1).
- **Band position vs %B.** `bandPosition` (the "Bollinger score") is centered:
  `0` = on the MA, `±1` = the ±kσ bands. Classic `%B` is `(b + 1)/2`; equivalently
  smoothing 0 + a short window reproduces %B.
- **Run / scale (`hd`).** A _run_ is a maximal stretch where the trend is
  sustained one direction (`runs.ts`). _Scale_ `hd` (days) is the single knob all
  run windows derive from (band = N·hd, EMA = α·hd, etc.).
- **Vote / sustainment.** The trend operator τ ∈ [−1,1] per day; the _vote_ is the
  trailing share of up-days; a run forms where the vote clears `sustThresh`
  (surfaced inverted as **sensitivity**).
- **Envelope vs distribution (forecast).** The _envelope_ sets how big a peak can
  be (decaying over time/value); the _distribution_ places peaks in time as a sum
  of Laplacian spikes. See §5.2.
- **Seed layer (Hodl).** A frozen set of buy-day indices resolved once from a
  driver/manual/uniform rule; strategies are the union of layers (§5.3).
- **Published vs loaded build.** _Loaded_ = the `__BUILD_ID__` baked into the
  running bundle; _published_ = the commit in the live origin's `version.json`
  (§7).
- **Project framing.** Indicators are **descriptive heuristics, not advice** —
  surface that in UI and be candid about in-sample / overfitting / scale caveats.
