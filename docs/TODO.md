# Forecast tab — TODO

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

## Next branch — Buy/Hodl indicator

A card pinned to the top of the **Hodl Explorer** that answers, for **today's
price**, "is this a buy day or a hodl day?" — judged by each currently-tuned
pattern.

- **Now (shipped as a stub):** evaluates today's price against each band-based
  driver as currently tuned — Price ÷ MA and Bollinger score (b) — and shows a
  per-pattern **BUY** (today's value sits in the accumulation band) or **HODL**
  verdict, plus a "N of M patterns say buy" summary. Pure/causal, reads only the
  latest data point. Lives in `HodlExplorer.vue` (`patternSignals`, `inBand`).
- **Future:** widen beyond the explorer's two band patterns into a collection of
  market-macro behaviours/patterns, each filtering for its own condition, then
  pool them into a single **buy-vs-hodl score** (weighting, agreement, regime
  awareness). Surface the contributing patterns so the score is explainable.
- **Caveat to keep visible:** these are pattern-based pickers over history;
  Bitcoin is not guaranteed to repeat past/present patterns — heuristic, not
  advice.

## Next branch — Indicator setup

> Deferred to a follow-up branch, to be started after the current
> metric-framework branch is merged.

### Indicator setup (do first)

The Price Explorer now has a metric-toggle framework: each metric is toggled
on/off, has its own collapsible config, and run-based metrics (b, runs overlay,
run slope) share one "Run parameters" group. Next:

- Promote the ad-hoc metric list into a small registry/spec (id, label, kind =
  overlay | curve, param schema, shared-param group) so metrics + their configs
  render from data instead of hand-written rows.
- Persist enabled metrics + params (localStorage / URL) so a view is shareable.
- Tidy defaults and grouping; make adding a new indicator a one-entry change.
- This registry is also what a future strategy-explorer's metric picker reads.

## Later — Hodl Explorer (after Indicator setup)

The owner's buying-strategy feature (replaces the retired DCA Explorer; **do
not** revive the heat-band prototype — see `docs/experience.md`). Builds on the
Indicator-setup metric registry, so it comes after that branch lands.

**Idea.** Seed a set of purchase dates over the price history, then live-simulate
"buy a uniform amount on each seeded date" and compare it against a baseline of
"buy a uniform amount on every day in the past X days."

### Seeding the purchase dates
- **Manual** — the user picks / adds individual dates (and can remove them).
- **Pattern spreading via indicators** — an indicator (from the metric registry)
  generates dates by spreading purchases across the days that meet a condition
  (e.g. buy where price ÷ MA < T, or where a run is in a chosen state). The
  indicator's params come from its registry config.
- **Combination** — manual dates plus indicator-spread dates, merged.

### Live simulation + comparison
- **Same total budget** on both sides, split uniformly across that side's
  buy-days — so the comparison is purely about *which* days, not how much.
- **Strategy:** budget ÷ (number of seeded dates) on each seeded date.
- **Baseline:** budget ÷ X on each of the trailing X days, counted back from
  today (X is a knob).
- **Compare (current worth & more):** value today, **cost basis** (avg buy
  price), BTC accumulated, ROI %, number of buys / amount deployed, and other
  side-by-side stats. Recompute live as the seeding or params change.

### Notes
- Reuse `useBitcoinData`; keep the simulation a pure function in `src/lib/` over
  the fetched arrays (causal where relevant), components thin.
- Indicator-driven seeding is exactly why **Indicator setup comes first** — the
  explorer reads the available drivers and their configs from that registry.

## DevOps / CI

The only workflow today is `deploy.yml` (Pages deploy on push to `main`). There
is no PR gate, no lint/format config, no test suite, and no Node-version pin —
so a broken build can (and once did) reach history. Prioritised backlog:

- [ ] **CI gate on PRs (do first).** Add `.github/workflows/ci.yml` that runs on
      pull_request → `main`: `npm ci` then `npm run build` (this already does
      `vue-tsc -b && vite build`, so it catches TS *and* Vue template errors).
      Use Node 22 + `cache: npm` to match `deploy.yml`. Make it a **required
      status check** in branch protection so PRs can't merge red. This is the
      single highest-value item — it's the gate `CLAUDE.md` already assumes.
- [ ] **Lint + format.** No ESLint/Prettier exists yet, but an auto-formatter is
      clearly in the loop (files keep getting reformatted). Codify it: add
      `eslint` (vue + @typescript-eslint) and `prettier` with a committed config,
      `npm run lint` / `npm run format:check` scripts, and run both in CI so
      style is deterministic instead of incidental.
- [ ] **Unit tests (Vitest).** `src/lib/` is pure functions over arrays — ideal
      to test and currently untested. High-value cases: `hodl.ts`
      (`simulateStrategy` math: known price path → known ROI/cost basis/BTC;
      `selectBandBuyDates`, `windowIndices`, `unionIndices`, `snapDateToIndex`);
      `runs.ts`/`indicators.ts` **causality** (mutating `price[>i]` must not
      change the decision at `i`); `forecast.ts` fit/projection invariants. Add
      `npm run test` to the CI gate.
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
