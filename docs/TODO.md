# Project TODO

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

- [x] Run/scale metric framework (Price Explorer), replacing the composite-heat
      subsystem. The engine is now `lib/runs.ts`: `scaleDiag(price, hd)` derives
      b, the sustained-trend vote, and runs at one continuously-tunable scale.
      The UI is a metric toggle list — Moving average, Bollinger, Runs overlay
      (all overlays), and Price ÷ MA, b score, Run slope (separate curves) —
      each with its own collapsible config; b / runs / run-slope share a "Run
      parameters" group (log scale slider + sensitivity). Default view is price
      only. **Removed:** the M/W composite heat tint, the buy/hold signal, and
      the Components diagnostic (`mwHeat`, `phaseMachine`, `MwHeatDiagnostic`).

- [x] Conceptual help docs + in-app help button. Authored
      `docs/concepts/{overview,price-explorer,price-mechanics,hodl-explorer}.md`
      describing each page's purpose, controls, how it works, and assumptions —
      readable by an AI agent *and* rendered in-app. Added a dependency-free
      Markdown renderer (`lib/markdown.ts`), a `HelpModal.vue` that imports the
      docs via `?raw` and renders them with a per-page nav, and a **? Help**
      button in the top-right of the header that opens the modal on the active
      page's doc.

- [x] Hodl Explorer (own tab) — buying-strategy sandbox. Seed-layer combinator in
      `lib/hodl.ts`: drivers (price ÷ MA band, Bollinger-score band, uniform
      spacing, manual dates) resolve to frozen layers unioned into a strategy;
      trailing-days **or** from/to comparison window; shared cash budget;
      strategy-vs-baseline **and** live preview-vs-baseline stats
      (`StatsCompare.vue`); a Buy/Hodl indicator card (per-pattern BUY/HODL for
      today). Price + driver-metric charts x-synced. Out-of-window manual dates
      flagged and excluded.

- [x] Bollinger score → single source of truth: `lib/indicators.ts` →
      `bandPosition = (EMAₛ(price) − SMA_W) / (k·σ_W)`, centered (±1 = ±kσ bands),
      with independent **Period (unit) / σ / Smoothing** (named-horizon label).
      Replaced the old run-scale `scaleDiag` score and the separate classic-%B
      curve (%B is just smoothing 0 + a short window). Used by both the Price
      Explorer curve and the Hodl `bscore` driver, each with its **own** params;
      the long-MA window is likewise decoupled per tab.

- [x] Misc merged cleanups: help rendering switched to `marked`; rebrand to
      **bitcoin1460** (app icon + Ubuntu/Orbitron title); shared period helpers
      in `lib/period.ts` (`toDays`, `UNIT_ABBR`, `namedScaleLabel`).

- [x] Price Explorer — collapsible metrics menu + crosshair-sync fix. Metric
      toggles live in a purple, click-to-collapse **Metrics** container
      (`menuCollapsed`; lists active metrics when folded). Crosshair synced via a
      shared `hoverIndex` + a self-drawn `graphic` line on each chart
      (`convertToPixel`), after ECharts `axisPointer.link` / programmatic `showTip`
      wouldn't propagate the pointer across the stacked separate-curve grids.

## Code consolidation

Single-source-of-truth pass — concrete duplication removed across components:

- [x] `lib/format.ts` — `fmtUSD` / `fmtPct` / `fmtBtc` (was copied in 6
      components). `fmtUSD` standardized on auto precision (cents <$10, else 0).
- [x] `lib/chartTheme.ts` — shared ECharts colour tokens (`AXIS`, `SPLIT`,
      `UP`/`DOWN`/`UP_RUN`/`DOWN_RUN`, `AMBER`, `BAND_FILL`, line colours)
      instead of per-file constants.
- [x] `lib/usePriceSeries.ts` — `prices` / `dates` / `toDateInput`
      (was in PriceExplorer + HodlExplorer; ForecastView now shares `prices`).
- [x] `lib/useBandScore.ts` — the Bollinger-score state (Period/unit/σ/smoothing
      refs + `bandPosition` series + labels), was fully duplicated across the
      Price Explorer and Hodl Explorer; each call keeps its own params.

## Docs

- [x] **Filled the `system-design.md` placeholders.** All sections §1–§9 are
      written from the source (§3/§4/§7/§8 in the docs-catchup pass; §2 data
      layer, §5.1 Price Explorer, §5.3 Hodl Explorer, §6 charting, §9 glossary,
      plus the §1 dependency/chart-group notes in the docs-completion pass). Keep
      current via the `CLAUDE.md` doc-checkpoint.
- [x] **Backfilled `experience.md` version history** — the skipped merges plus
      the recent freshness / docs / Prettier / explorer work now each have an
      entry.

## Version freshness / reload

- [x] **Phase 1 — published-version check (merged).** `emit-version-json` Vite
      plugin writes `version.json` (`{ commit, builtAt }`) outside the SW precache;
      `lib/useVersionCheck.ts` polls it cache-busted and compares the live origin's
      *published* commit to the loaded `__BUILD_ID__`. Footer shows *Up to date* vs
      *Update ready — Reload* instead of silently reloading. See `system-design.md` §7.
- [ ] **Phase 2 — built-vs-published "publishing…" state.** Track the latest
      *built* commit (which may not be live yet) and compare against *published* to
      show a third state during the build→publish window. Decide the source: the
      deploy workflow writes the commit to a static file the app can read
      (`raw.githubusercontent.com/<repo>/main/version-built.json`, or a small
      `build-status` branch/artifact), **or** the GitHub commits API for `main`.
      Gotchas: unauthenticated GitHub API is 60 req/hr/IP, so a 60s poll must hit a
      *static* file, not the API (or poll far less often); confirm the deployed
      origin can reach `raw.githubusercontent.com` (public, fine — sandbox can't, so
      device-validated).

## Stochastic price mechanics — projections with confidence

**Goal.** Turn the deterministic point projection into a **predictive
distribution**: a mid (median) path plus low/high bands at chosen confidence
levels, derived soundly from the fit rather than eyeballed. The same recipe must
cover **both** the value-growth curve and the volatility curve.

### The statistical core (recommended — simple, elegant, sound)

Everything happens in **log space**, because price is multiplicative and
strictly positive (a lognormal model is the natural choice; additive/linear
bands would allow negative prices and mis-scale the swings). Decompose:

```
log(price_t) = log(baseline_t) + r_t
```

- `baseline_t` — the fitted growth curve (the *mean/centre* trend; today's
  `modelMa`). This is the value-growth model.
- `r_t = log(price_t / baseline_t)` — the **log-residual**, which *is* the log of
  the volatility multiplier the tab already models. Its spread is the volatility.

There are two distinct, separable uncertainty sources — name them and treat them
separately:

1. **Residual dispersion** (dominant for BTC) — how far price swings around the
   baseline, i.e. the distribution of `r_t`. This is what gives wide, useful
   bands.
2. **Parameter uncertainty** — how well-pinned the fit coefficients are. Small
   in-sample, **grows on extrapolation**; for BTC it's dwarfed by (1), so it's a
   refinement, not the headline.

**Predictive band at future time t** (level `q`, e.g. 80/90/95%):

```
price_q(t) = exp( ŷ(t) + Q_q(t) )         ŷ(t) = log baseline_t
```

with two interchangeable ways to get the spread `Q_q(t)`:

- **Parametric (lognormal):** `Q_q(t) = z_q · s(t)`, where `s(t)` is the
  log-residual std and `z_q` the normal quantile (1.28 / 1.645 / 1.96 for
  80/90/95%). Two-number summary; elegant.
- **Empirical (distribution-free):** `Q_q(t) = quantile_q(residuals)` via the
  existing `percentile()` helper. Robust to BTC's heavy tails / skew; preferred
  as the default, with the parametric form as a smooth fallback.

`mid = exp(ŷ(t))` (or the residual median if residuals aren't centred). This
directly yields **high/mid/low with confidence levels** — the stated end goal.

### Unify the spread with the existing volatility envelope

Right now the envelope is fit only to **peak** `price/MA` ratios (an upper
*ceiling*). Reinterpret it as the **conditional scale of the residuals**: fit the
decay model (the existing `value-exponential-decay` etc. forms) to a rolling
robust scale of `r_t` (trailing std, or MAD for robustness) instead of to peaks.
Then `s(t)` *is* the envelope, the cone **narrows as volatility decays**, and the
"future variability knob" the owner described becomes concrete: **the recency
window / decay rate used to estimate `s(t)`** (how much of the past variance to
carry forward). Same fit→centre + residual-scale recipe is then laid out
identically for value growth and for volatility growth, as requested.

### On the owner's ad-hoc idea (tune to MA ± a Bollinger band)

Tuning the growth fit to the MA *and* to ±k·σ bands is a **special case** of the
above: a Bollinger band is exactly `baseline · exp(±k·σ)`, so picking `k` is
picking a confidence level (k=1.645 → 90%). The cleaner equivalent is to fit the
centre once (to log-price or its MA) and let the bands fall out of the
**residual** σ — no separate "tune to the bands" step, and `k`/quantile maps to a
real probability. So: keep the instinct (centre + symmetric spread, a single
future-variability knob), but source the spread from the growth-fit residuals.

### Phased implementation

- [ ] **Phase 0 — stub the predictive cone (this branch's candidate goal).**
      Pure functions in `forecast.ts`: `residuals(price, baseline)` →
      `dispersion(r, {weights})` (reuse the recency weights `γ`) → quantiles
      (empirical via `percentile`, or `z·σ`). Extend `ForecastResult` with `lo /
      mid / hi` arrays per level; `ForecastChart` renders a shaded fan + lines.
      UI: a **confidence-level** picker (80/90/95%) and a **σ-lookback/recency**
      knob. Stationary σ first — honest and minimal.
- [ ] **Phase 1 — heteroscedastic `s(t)` via the envelope.** Fit the decay model
      to the rolling residual scale; bands narrow over time; retire the
      peaks-only envelope (or keep it as a separate "ceiling" overlay).
- [ ] **Phase 2 — parameter uncertainty + path-wise fans.** Either the analytic
      OLS prediction-interval term `σ²·(1 + 1/n + (x*−x̄)²/Sxx)` from `linregress`
      (extend it to return the coefficient covariance), or a **bootstrap**
      (resample residuals; refit → ensemble of baselines → CI). For honest fan
      charts, **moving-block bootstrap / AR(1)** on `r_t` to preserve
      autocorrelation, optionally Monte-Carlo sample paths.

### Caveats to honour (don't oversell the probabilities)

- **Autocorrelation.** BTC residuals are strongly serially correlated (multi-year
  cycles). i.i.d. quantiles give *marginal* (per-horizon) bands, **not** path
  probabilities, and understate how long price can sit above/below trend. Phase 0
  bands must be labelled as marginal; path-wise honesty needs Phase 2's block
  bootstrap/AR.
- **Non-stationarity / regime change.** Every band is conditional on "the future
  resembles the past." Volatility has structurally declined; if it reverts, the
  cone is too tight. These are scenarios, not guarantees — keep the existing
  not-advice framing.
- **Distribution shape.** Residuals are heavy-tailed/skewed → prefer empirical
  quantiles over normal-`z` for the headline bands.
- **Cycle peaks** shift the *mean* deterministically; uncertainty in peak
  timing/height is a separate source (could widen bands near projected halving
  peaks) — out of scope until Phase 2+.
- **Calibration ≠ in-sample fit.** R² measures historical fit, not interval
  coverage. Add a **backtest**: do the 90% bands actually contain ≈90% of
  held-out points? (a PIT histogram makes mis-calibration visible). This is the
  real test of "confidence levels."

## Later / ideas

- **Metric registry + persistence (prototyped, not merged).** A spec-driven
  metric system (`lib/metricRegistry.ts`: `MetricSpec`/`MetricState`, data-driven
  toggle rendering, localStorage + URL-encoded persistence for shareable views)
  was built on `claude/inspiring-bardeen-lHExI` (commit `cec9ac2`) but **never
  merged** — on `main` the toggles are plain in-memory refs with no persistence.
  Was previously (incorrectly) marked Done. Revive only if the indirection earns
  its keep; see the "Metric registry … never merged" entry in `experience.md`.
- **Buy/Hodl indicator — pooled score.** Widen beyond the two band patterns into
  a collection of market/macro patterns and pool them into one explainable
  buy-vs-hodl score (weighting, agreement, regime awareness). Heuristic, not
  advice.
- **Indicator-registry-driven Hodl seeding.** Let the Hodl drivers read from the
  Price Explorer's metric registry so any indicator can spread buy-dates.
- **`forecast.ts` unit tests** — fit/projection invariants, to extend the CI net.

## UI component framework / design system

**Goal.** Today every tab hand-rolls its own markup + scoped CSS, so the same
visual ideas (collapsible containers, labelled inputs, tooltips, tabs) are
re-implemented per file with subtle drift — e.g. the label/tooltip wrap bug we
just fixed existed because the label-with-`InfoTip` pattern wasn't a component.
Categorise the recurring UI, extract a small set of abstracted components +
design tokens, and migrate the tabs onto them. **Long-term vision:** make the
app a tree of nested components under one page shell, and harvest that into a
**reusable project template** (premade widgets + styles, à la Palantir Foundry
Workshop) that new apps can assemble from.

### Component inventory (category · functionality · where it appears)

- **Page shell** — title bar, help button, tab nav, footer build-stamp/debug
  panel. One instance: `App.vue` (`.app`, `.title-row`, `nav.tabs`,
  `footer.debug`). This is the "one big page container" the rest nests under.
- **Tabs** — a set of mutually-exclusive buttons, each **bound to one container**;
  selecting a tab shows its container and hides the siblings. So a tab strip is
  really *a driver of container visibility* (see Container, below) with a clean
  buttons↔container interface, not a bespoke widget. Genuine tabs: main nav
  (`App.vue nav.tabs`, drives the three page containers), the forecast chart
  switcher (`ForecastView` `.chart-tabs`) and the Hodl driver-chart switcher
  (both pick which graph container shows). **Not a tab:** the Trailing/Range
  `.toggle` (`HodlExplorer`) — that's a stateful toggle *button* flipping between
  two comparison-window containers; it belongs under Buttons + Container
  visibility, just driven by a 2-state toggle instead of a tab strip.
- **Container / panel** *(highest-variation category)* — a bordered, optionally
  themed box with a header, and these orthogonal functionalities: **conditional
  visibility** (shown/hidden by an external driver — a tab, a toggle button, or a
  state flag), **collapsibility** (expand/collapse its own body), **theme**, and
  **size**. Variants seen:
  - `.metrics-section` (`PriceExplorer`) — violet theme, **whole-face tap** to
    collapse, header shows chevron + active-summary + hint.
  - `.params` / `.calibration` (`ForecastView`) — bordered card, **header-tap**
    collapse (chevron + hint); `.calibration` is the violet-accent variant.
  - `.metric` (`PriceExplorer`) — per-metric card whose body is toggled by a
    **gear icon** (`.cfg`), header = checkbox-label + `InfoTip` + gear.
  - The Trailing vs Range comparison-window panels (`HodlExplorer`) — two
    containers, **visibility driven** by the Trailing/Range toggle button.
  - The per-graph chart containers — **visibility driven** by the chart tabs.
  - `.indicator` (`HodlExplorer` Buy/Hodl), `.window-panel`, `.ctrl-label`
    groups, StatsCompare `.stat-col` — bordered groupings, mostly non-collapsing.
  - Variation axes to fold into props/variants: **visibility** (always / driven),
    **collapse mode** (none / header-tap / icon), **theme** (default / violet /
    accent), **size** (compact / regular), **header slots** (title, sub-note,
    hint, summary, trailing action).
- **Labelled field** — a label (often with an `InfoTip`) above/beside a control,
  sometimes with a **unit adornment**. Everywhere: `.controls label`,
  `.ctrl-label`, `.param-grid label`, the `.period` composite (number + unit
  `<select>`), `.num-input` (+ `.sm`) with `.unit` prefix/suffix (`$`, `days`,
  `to`, `→`, `offset`). The tooltip-wrap fix lives here — a `Field` component
  would make it structural.
- **Inputs** — number / date / `<select>` / range slider (`.slider` + `.val`
  readout). Globally themed in `style.css`; the composite/adorned forms recur.
- **Buttons** — one base style (`style.css`) + many ad-hoc variants: primary/
  accent (`.reset` violet), icon-only (`.cfg` gear, `.peak-remove` ×), ghost/
  text (`.curves-toggle`), chip/segmented (`.toggle`, tab buttons), plus
  `.help-btn`, `+ Add layer`, `Retry`, `.debug-toggle`, `Copy log`. Includes the
  **stateful toggle button** (Trailing/Range) that drives container visibility.
- **Stat / indicator row + status badge** — `label · value · BUY/HODL pill`
  (`HodlExplorer` `.indicator`) and `label · value` (`StatsCompare`). The
  BUY/HODL/`.active` pill is a reusable **badge**.
- **Charts** — ECharts wrappers: `PriceChart`, `MetricsPanel`, `ForecastChart`,
  Hodl driver chart. Already share `lib/chartTheme.ts` tokens, an
  `echarts.connect` group, and the self-drawn crosshair bridge — but the bridge
  logic is copy-pasted between `PriceChart` and `MetricsPanel`.
- **Custom HTML legend** — the colour-key rows above the forecast/Hodl charts.
- **Captions / notes** — `.fit-note`, `.calib-note`, `.cfg-note`, `.eq`,
  `.indicator-note`, disclaimers: a shared muted-text typography role.
- **Status / banner** — `.status`, `.status.error` (loading/retry), footer
  debug panel.

### Variants over per-instance tuning

Rather than hand-tuning padding, sizing, and background transparency on each
component, the components where those properties matter expose a small fixed set
of **premade variants**, and call sites pick one instead of overriding CSS:

- **Size:** `compact` / `regular` (e.g. the collapsed panels we just hand-slimmed
  become `size="compact"`; dense control rows vs. roomy sections).
- **Emphasis / style:** `ghost` / `regular` / `bold` (e.g. `.curves-toggle` is
  ghost, a normal button is regular, the violet `.reset` / primary action is
  bold). Maps cleanly onto buttons, and the `theme` axis on containers.

This is the mechanism behind "tokens + utility classes": a variant is just a
named bundle of tokens, so there's one place to change what `compact` or `bold`
means and no magic numbers sprinkled across scoped styles.

### Suggested abstraction order (foundation → leaves → template)

1. [~] **Design tokens + variants + utility classes first.** Promote the repeated
   colours, radii, spacing, the violet-accent container theme, and the button
   styles into CSS custom properties + the `size` (compact/regular) and `emphasis`
   (ghost/regular/bold) variant bundles + a few utility classes (extends the
   existing `:root` vars and `lib/chartTheme.ts`). Cheap, low-risk, and everything
   else consumes these instead of magic numbers. **Buttons stay native** —
   variants ship as CSS classes (`btn btn-bold btn-compact`), no `<Button>`
   wrapper. **Done:** `--accent-violet-tint` token; `size`/`theme` variants on
   `<Panel>`. **Remaining:** the button `emphasis` (ghost/regular/bold) variant
   classes + broader token extraction.
2. [x] **`<Panel>`** *(done — `claude/ui-panel-foundation`)*. Props landed:
   `title`, `subtitle`, `theme` (`default|violet`), `size` (`regular|compact`),
   `collapsible` (`none|header|face|icon`), `v-model:collapsed`; `#header` /
   `#summary` / `#actions` slots. Migrated the Metrics menu (face), the five
   metric cards (icon), and the Calibration / growth / volatility panels (header)
   — biggest dedupe, kills the collapse-pattern drift. **Remaining:** a `visible`
   prop for external (tab/toggle) visibility control (lands with `<Tabs>`).
3. **`<Field>` / `<LabeledControl>`** — label + optional `InfoTip` + control +
   unit adornment, in row or column layout. Folds the tooltip-wrap fix in
   structurally and removes the most boilerplate.
4. **`<Tabs>` (visibility selector).** A `v-model`-driven tab strip whose only job
   is "which bound container is visible." Unify main nav + the two chart
   switchers. The Trailing/Range case is *not* part of this — it's a stateful
   toggle button (a Button variant) driving the same `Panel.visible` interface, so
   tabs and toggles share one clean buttons↔container contract.
5. **`<Badge>` + `<StatRow>`** — the value/pill rows in the indicator and stats.
6. **Chart concerns as composables, not one mega-component** — extract
   `useCrosshairBridge()` and a small `useEChart()` setup helper; optionally a
   `<ChartLegend>`. Keep each chart its own component.
7. **Template harvest (phase 3).** Once 1–6 land, document the kit (a gallery/
   Storybook-style page), and only then consider spec/registry-driven assembly
   — this is where the dormant `metricRegistry` prototype (see *Later / ideas*)
   could return as the data-driven layer.

### My take — valuable vs. over-engineering

- **Clearly worth it:** the **design tokens**, **`<Panel>`**, and **`<Field>`**
  abstractions. They're the most duplicated, the most drift-prone (this branch
  alone touched all three by hand), and each has obvious, bounded props. Start
  here.
- **Worth it, smaller:** `<Tabs>`, `<Badge>`/`<StatRow>`, and pulling the
  crosshair bridge into a composable (removes a real copy-paste between two
  charts).
- **Decided (agreed):**
  - **No `<Button>` wrapper.** Native `<button>` + CSS variant classes give 90%
    of the value with none of the prop-plumbing; only componentise if a button
    grows real behaviour.
  - **Charts stay separate components** sharing *composables* (`useCrosshairBridge`,
    `useEChart`), not one generic `<Chart>` god-component — the charts genuinely
    differ (axes, overlays, stacked grids, crosshair math) and one abstraction
    would be lossy.
- **Likely over-engineering (defer / avoid):**
  - A full theming engine / many container themes before there are consumers —
    ship 2–3 themes (default / violet / danger), not a configurable palette.
  - Registry/slot-driven page assembly *now* — it's the end-state vision, but
    premature before the leaf components and their props have settled; it's how
    the earlier metric-registry attempt over-reached and went unmerged.
- **Sequencing principle:** abstract only on the *third* occurrence and only
  once the variation axes are known, so the props match reality instead of being
  guessed up front. Tokens → `Panel`/`Field` → the rest, migrating one tab at a
  time behind a green build.

## DevOps / CI

The only workflow today is `deploy.yml` (Pages deploy on push to `main`). There
is no PR gate, no lint/format config, no test suite, and no Node-version pin —
so a broken build can (and once did) reach history. Prioritised backlog:

- [x] **CI gate on PRs.** `.github/workflows/ci.yml` runs on pull_request → `main`
      (and push to `main`): `npm ci`, `npm run test:run`, then `npm run build`
      (`vue-tsc -b && vite build`, catching TS + Vue template errors). Node 22 +
      `cache: npm` to match `deploy.yml`; `concurrency` cancels superseded runs.
      **Remaining manual step:** mark the `build` check **required** in
      Settings → Branches → branch protection so red PRs can't merge.
- [x] **Unit tests (Vitest).** Seeded `src/lib/*.test.ts` (13 tests): `hodl.ts`
      math (`simulateStrategy` ROI/cost-basis/BTC) + `selectBandBuyDates` /
      `windowIndices` / `unionIndices` / `snapDateToIndex` / `uniformSpacedDates`;
      `indicators.ts` `sma`/`ema`/`bollinger`/`bandPosition` incl. a **causality**
      assertion (mutating `price[>i]` doesn't change `b` at `i`). Run via
      `npm run test:run`, wired into CI. Tests excluded from the production
      type-check (`tsconfig.app.json`). Next: `forecast.ts` invariants.
- [~] **Lint + format.** **Prettier config landed** (`.prettierrc.json` —
      no-semi / single-quote / 100-col; `format` / `format:check` scripts).
      **Remaining:** run the one-shot `npm run format` pass (≈26 files) on a clean
      branch, then add `format:check` to CI; and add `eslint` (vue +
      @typescript-eslint) with an `npm run lint` script wired into CI.
- [ ] **Pin the Node version.** Add `.nvmrc` (22) and an `engines` field so local
      dev matches CI/deploy and avoids "works on my machine" drift.
- [ ] **Automated dependency updates.** Add `.github/dependabot.yml` for `npm`
      and `github-actions` (vite / echarts / capacitor / vite-plugin-pwa move
      fast). The CI gate above makes these safe to review/merge.

### Lower priority / nice-to-have

- [ ] **Bundle-size guard.** The build warns the main chunk is >500 kB (echarts
      dominates). Either split it (`manualChunks` / dynamic `import()` for the
      forecast + chart code) or add a `size-limit` check so regressions surface.
- [ ] **PR hygiene.** A short PR template (what / why / testing) and optionally
      `CODEOWNERS`, to match the what/why/testing summary `CLAUDE.md` asks for.
- [ ] **Preview-deploy provenance.** The footer already stamps `build <sha>`;
      consider surfacing the same in CI artifacts so a Netlify preview can be
      tied back to a commit at a glance.

## Delivery & native targets (down the line)

The "one codebase, three delivery targets" path (web → installable PWA → native
app) folded out of the README. Today only **web + PWA** ship; the native-like
polish and the native shells are future work:

- [~] **PWA / native-like install.** Live today: `vite-plugin-pwa` emits the
      manifest + service worker, the app is installable ("Add to Home Screen")
      and works offline, and icons generate from `public/logo.svg`
      (`npm run generate-pwa-assets`). **Down the line:** harden the on-device
      install/standalone experience — splash + maskable icons, iOS standalone
      quirks (status-bar, safe-area, no-bounce), and an in-app "install" prompt.
      (Freshness/reload — a related PWA concern — is tracked under *Version
      freshness / reload*.)
- [ ] **Capacitor native apps (iOS / Android).** Pre-wired but **dormant**:
      `capacitor.config.ts` exists and `cap:add:ios` / `cap:add:android` /
      `cap:sync` scripts are present, but **no `ios/` or `android/` project is
      committed**. Down the line, to ship real store apps from the same web build:
      add the native projects (needs macOS + Xcode / Android Studio), wire
      `cap:sync` into the build, decide which native plugins (if any) are needed,
      and sort out signing + store listings. Decide first whether native is worth
      it over the PWA, or keep it as an optional path.
- [ ] **Pick the canonical install story.** PWA and native overlap; choose what
      we actually point users to (likely PWA-first) so the docs/UX don't promise
      two things we half-maintain.
