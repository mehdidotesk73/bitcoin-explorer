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

- [x] Indicator setup — metric registry. `lib/metricRegistry.ts` (id, label,
      kind, param schema, shared-param groups) drives the Price Explorer's metric
      toggles from data; enabled metrics + params persist (localStorage / URL).

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

## Later / ideas

- **Buy/Hodl indicator — pooled score.** Widen beyond the two band patterns into
  a collection of market/macro patterns and pool them into one explainable
  buy-vs-hodl score (weighting, agreement, regime awareness). Heuristic, not
  advice.
- **Indicator-registry-driven Hodl seeding.** Let the Hodl drivers read from the
  Price Explorer's metric registry so any indicator can spread buy-dates.
- **`forecast.ts` unit tests** — fit/projection invariants, to extend the CI net.

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
- [ ] **Lint + format.** No ESLint/Prettier exists yet, but an auto-formatter is
      clearly in the loop (files keep getting reformatted). Codify it: add
      `eslint` (vue + @typescript-eslint) and `prettier` with a committed config,
      `npm run lint` / `npm run format:check` scripts, and run both in CI so
      style is deterministic instead of incidental.
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
