# CLAUDE.md

Guidance for any Claude session working in this repo. Read this first, then
fall straight into the lifecycle below.

## What this is

A Vue 3 + TypeScript + Vite single-page app (also a PWA, with Capacitor for
iOS/Android shells) that explores Bitcoin price data. Two tabs:

- **Price Explorer** — raw price plus a **metric framework**. Each metric
  toggles on/off and carries its own collapsible config. Overlays on the price
  chart: Moving average, Bollinger bands, Run detection (a piecewise-linear run
  skeleton). Separate curves (in a collapsible panel below): Price ÷ MA (long
  MA, log axis), Bollinger score (`b` = band position), Run slope. Run detection
  and the run-derived curves share a scale + sensitivity.
- **Price Mechanics** (the forecast tab) — a structured what-if engine that fits
  growth/volatility/peak models to history and projects forward.

The user previews on a **phone** (mobile Safari), so favour mobile-friendly
layouts and remember there's no dev console on device — see Debugging below.

## Development lifecycle (follow this every time)

1. **Branch.** Start every feature on its own branch off the latest `main`:
   ```
   git checkout main && git pull --ff-only origin main
   git checkout -b claude/<short-feature-name>
   ```
   - Branches are named `claude/<feature>`. Pick a name that describes what the
     branch *does* — e.g. `claude/hodl-explorer`, `claude/metric-registry`,
     `claude/run-scale-slider`. Avoid auto-generated names like
     `claude/inspiring-bardeen-lHExI`.
   - **Always verify the base after branching** (this has bitten us): confirm
     `git log --oneline origin/main..HEAD` is empty and the expected files are
     present. A stale/pre-existing branch can fork from an old commit.

2. **Edit in small, reviewable commits.** Keep changes focused. After each
   logical change, **build before committing** — see Build & verify.

3. **Commit + push.** Conventional, descriptive messages. Push to the feature
   branch (never straight to `main`): `git push -u origin claude/<feature>`.
   Network can be flaky; retry pushes with backoff.

4. **Preview via Netlify.** Each PR/branch gets a **Deploy Preview** URL
   (`deploy-preview-<n>--bitcoin-analysis.netlify.app`). The user tests there on
   their phone. The footer shows the live `build <sha>`; confirm it matches the
   commit you pushed.
   - **Service-worker cache caveat:** this is a PWA, so an old bundle can keep
     serving. If a change "doesn't show," it's almost always the cache — have
     the user tap **Reload latest** in the footer, or open the URL in a
     **private/incognito tab**.

5. **PR via GitHub.** Open a PR into `main` with a what/why/testing summary.
   - Use the GitHub MCP tools (`mcp__github__*`) — there is **no `gh` CLI** and
     no direct API. Prefer MCP for PRs/branches/files when local pushes fail.
   - Do **not** merge — the user merges. Keep PR comments frugal.

6. **Merge + test production.** The user merges in the GitHub UI. Merging to
   `main` triggers the **GitHub Pages** production deploy (see Deploys).

7. **Checkpoint the docs.** On the same change:
   - **`docs/TODO.md`:** move the finished item to Done (one-paragraph summary +
     key function names); queue follow-ups under Next branch.
   - **`docs/experience.md`:** on every **merge**, add a Version-history entry
     summarising the changes vs the previous version (added / removed / defaults
     / docs). On every **branch removal / abandonment**, add a "What didn't
     work" entry — what was tried, whether we know *why* it didn't work, and the
     reason (or honestly "direction felt unideal"). This is how we avoid
     re-walking dead ends.

### Reverts / fixing main

- `main` is protected — **force-push is rejected**. To undo something on `main`,
  add a revert commit via a normal PR (revert the merge commit with `-m 1`), or
  push files through the GitHub MCP API. To re-introduce a reverted feature,
  "revert the revert" on a fresh branch (a plain re-merge won't work — Git sees
  it as already merged).
- Deleting/abandoning a branch → record it in `docs/experience.md` (above).

## Build & verify

- **Type-check + build:** `npm run build` (runs `vue-tsc -b && vite build`).
  This is the gate — it catches TS errors *and* Vue template parse errors.
  **Run it before every commit.** A broken build has reached history before
  because nothing ran it; don't let that happen.
- There is **no test suite and no CI build gate** on PRs yet (a known gap — see
  `docs/TODO.md`). `npm run build` passing locally is the bar.
- The price API is **not reachable from this sandbox** (host allowlist), so you
  cannot run the live app or reproduce data-dependent results here. Reason about
  algorithms from the code, and lean on the user's on-device screenshots/logs to
  validate. Be honest about what you can't verify offline.

## Deploys

- **Production = GitHub Pages**, built by `.github/workflows/deploy.yml` on push
  to `main`. It bakes the repo name into the asset base path, so a repo rename
  needs a fresh deploy. URL: `https://<owner>.github.io/<repo-name>/`.
- **Netlify = preview only** (`netlify.toml`) — per-PR/branch Deploy Previews.

## Repo structure

```
src/
  App.vue                  tabs shell + on-screen debug panel + PWA reload
  main.ts, pwa.ts          bootstrap; service-worker auto-update + reload
  debug.ts                 logDebug() → on-screen log (mobile has no console)
  api/
    bitcoin.ts             Binance price fetch
    supplemental.ts        pre-2017 daily closes (CoinMarketCap-sourced)
  lib/
    useBitcoinData.ts      shared fetch/cache composable, fed to both tabs
    indicators.ts          SMA, Bollinger bands (pure functions over arrays)
    runs.ts                scaleDiag(price, hd): b, trend vote, runs at one scale
    forecast.ts            forecast engine: fits + projection (see forecast-model.md)
  components/
    PriceExplorer.vue      Price Explorer tab: metric toggles + configs
    PriceChart.vue         echarts price chart + overlays (MA, Bollinger, runs)
    MetricsPanel.vue       collapsible separate-curve panel (ratio, b, run slope)
    ForecastView.vue       Price Mechanics tab (controls + params)
    ForecastChart.vue      echarts forecast chart
docs/
  TODO.md                  living backlog (Done / Next branch / Housekeeping)
  experience.md            what didn't work + per-merge version history
  forecast-model.md        the forecast model spec
.github/workflows/deploy.yml   GitHub Pages production deploy
netlify.toml                   preview-deploy config
```

## Conventions & gotchas

- **Charts use ECharts** (`echarts/core` + explicit `echarts.use([...])` — register
  any new component/chart type you use). Two known gotchas:
  - On a **category x-axis**, `visualMap` and per-segment `lineStyle` colour do
    **not** bind; for per-point colour use a series with per-point `itemStyle`
    (see the run-slope bars in `MetricsPanel.vue`).
  - Crosshair + x-zoom are synced across the explorer's separate chart instances
    by putting them all in one `echarts.connect('btc-explorer')` group.
- **Pure logic lives in `src/lib/`** as plain functions over the already-fetched
  arrays — they recompute instantly with no refetch. Keep new metrics there and
  keep components thin. Metrics must be **causal** (decide day `i` from data
  ≤ `i` only).
- **Indicators are heuristics, not advice.** Surface that in the UI, and be
  candid about in-sample / overfitting / scale caveats.
- **Mobile-first:** the user is on a phone. Keep controls tappable.

## Debugging on device (no console)

- `logDebug(msg)` from `src/debug.ts` appends to the **on-screen log panel**
  (expand via the footer build stamp). There's a **Copy log** button so the user
  can paste values back.
- When something's invisible/not-working on device, add a **one-shot, guarded**
  diagnostic (in `onMounted`, wrapped in try/catch) and ask the user to copy the
  log. Remove or quiet noisy logs before merge.

## Reference docs

- `docs/TODO.md` — current backlog and what's been done.
- `docs/experience.md` — dead ends (with reasons) + version history.
- `docs/forecast-model.md` — the Price Mechanics / forecast model spec.
