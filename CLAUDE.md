# CLAUDE.md

Guidance for any Claude session working in this repo. Read this first, then
fall straight into the lifecycle below.

## What this is

A Vue 3 + TypeScript + Vite single-page app (also a PWA, with Capacitor for
iOS/Android shells) that explores Bitcoin price data. Two tabs:

- **Price Explorer** — raw price + indicators (SMA, Bollinger bands, the M/W
  price-heat indicator, and the heat-driven DCA exploration).
- **Price Mechanics** (the forecast tab) — a structured what-if engine that fits
  growth/volatility/peak models to history and projects forward.

The user previews on a **phone** (mobile Safari), so favour mobile-friendly
layouts and remember there's no dev console on device — see Debugging below.

## Development lifecycle (follow this every time)

This is the routine we've settled into. Stick to it.

1. **Branch.** Start every feature on its own branch off the latest `main`:
   ```
   git checkout main && git pull --ff-only origin main
   git checkout -b claude/<short-feature-name>
   ```
   - Branches are named `claude/<feature>` (e.g. `claude/dca-explorer`).
   - **Always verify the base after branching** (this has bitten us): confirm
     `git log --oneline origin/main..HEAD` is empty and the expected files are
     present. A stale/pre-existing branch can fork from an old commit.

2. **Edit in small, reviewable commits.** Keep changes focused. After each
   logical change, **build before committing** — see Build & verify.

3. **Commit + push.** Conventional, descriptive messages. Push to the feature
   branch (never straight to `main`):
   ```
   git push -u origin claude/<feature>
   ```
   Network can be flaky; retry pushes with backoff if they fail.

4. **Preview via Netlify.** Each PR/branch gets a **Deploy Preview** URL
   (`deploy-preview-<n>--bitcoin-analysis.netlify.app`). The user tests there on
   their phone. The footer shows the live `build <sha>`; tell the user to
   confirm it matches the commit you pushed.
   - **Service-worker cache caveat:** this is a PWA, so an old bundle can keep
     serving. If a change "doesn't show," it's almost always the cache — have
     the user tap **Reload latest** in the footer, or open the URL in a
     **private/incognito tab** to bypass the service worker entirely.

5. **PR via GitHub.** Open a PR into `main` with a summary of what/why/testing.
   - Use the GitHub MCP tools (`mcp__github__*`) — there is **no `gh` CLI** and
     no direct API. The local `git` proxy can be down even when the MCP API
     works, so prefer MCP for PRs/branches/files when pushes fail.
   - Do **not** merge — the user merges. Keep PR comments frugal.

6. **Merge + test production.** The user merges the PR in the GitHub UI.
   Merging to `main` triggers the **GitHub Pages** production deploy (see
   Deploys). After merge, the user verifies the production site.

7. **Checkpoint the TODO.** Fold the finished item into `docs/TODO.md` Done and
   queue follow-ups under Next branch (see TODO conventions).

### Reverts / fixing main

- `main` is protected — **force-push is rejected**. To undo something on `main`,
  add a revert commit via a normal PR (revert the merge commit with `-m 1`), or
  push files through the GitHub MCP API. To later re-introduce a reverted
  feature, "revert the revert" on a fresh branch (a plain re-merge won't work —
  Git sees it as already merged).

## Build & verify

- **Type-check + build:** `npm run build` (runs `vue-tsc -b && vite build`).
  This is the gate — it catches TS errors *and* Vue template parse errors.
  **Run it before every commit.** A broken build has reached history before
  because nothing ran it; don't let that happen.
- There is currently **no test suite and no CI build gate** on PRs (a known
  gap — see `docs/TODO.md` Housekeeping). `npm run build` passing locally is the
  bar.
- The price API is **not reachable from this sandbox** (host allowlist), so you
  cannot run the live app or reproduce data-dependent results here. Reason about
  algorithms from the code, and lean on the user's on-device screenshots/logs
  to validate. Be honest about what you can't verify offline.

## Deploys

- **Production = GitHub Pages**, built by `.github/workflows/deploy.yml` on push
  to `main`. It bakes the repo name into the asset base path
  (`BASE_PATH: /${{ github.event.repository.name }}/`), so a repo rename needs a
  fresh deploy. Production URL: `https://<owner>.github.io/<repo-name>/`.
- **Netlify = preview only** (`netlify.toml`) — per-PR/branch Deploy Previews;
  `base` stays `/` there. Netlify's PR checks ("Pages changed", "Header/Redirect
  rules") are Netlify, not GitHub Pages.

## Repo structure

```
src/
  App.vue                  tabs shell + on-screen debug panel + PWA reload
  main.ts, pwa.ts          bootstrap; service-worker auto-update + reload
  debug.ts                 logDebug() → on-screen log (mobile has no console)
  style.css
  api/
    bitcoin.ts             Binance price fetch
    supplemental.ts        pre-2017 daily closes (CoinMarketCap-sourced)
  lib/
    useBitcoinData.ts      shared fetch/cache composable, fed to both tabs
    indicators.ts          SMA, Bollinger, mwHeat (M/W heat), DCA scoring
    forecast.ts            forecast engine: fits + projection (see forecast-model.md)
  components/
    PriceExplorer.vue      Price Explorer tab (indicators + DCA exploration)
    PriceChart.vue         echarts price/indicator chart
    DcaSweepChart.vue      DCA band-centre sweep curve
    ForecastView.vue       Price Mechanics tab (controls + params)
    ForecastChart.vue      echarts forecast chart
docs/
  TODO.md                  living backlog (Done / Next branch / Housekeeping)
  forecast-model.md        the forecast model spec
.github/workflows/deploy.yml   GitHub Pages production deploy
netlify.toml                   preview-deploy config
```

## Conventions & gotchas

- **Charts use ECharts** (`echarts/core` + explicit `echarts.use([...])`
  registration — register any new component/chart type you use). Known
  gotcha: on a **category x-axis**, `visualMap` and per-segment `lineStyle`
  colour do **not** bind; for per-point colour use a **scatter series with
  per-point `itemStyle`** (see the M/W heat rendering in `PriceChart.vue`).
- **Pure logic lives in `src/lib/`** as plain functions over the already-fetched
  arrays — they recompute instantly with no refetch. Keep new indicators/metrics
  there and keep components thin.
- **Indicators are heuristics, not advice.** Surface that in the UI, and be
  candid about in-sample/overfitting/scale caveats when presenting backtests.
- **Mobile-first:** the user is on a phone. Test layouts accordingly; keep
  controls tappable.

## Debugging on device (no console)

- `logDebug(msg)` from `src/debug.ts` appends to the **on-screen log panel**
  (expand via the footer build stamp). Consecutive duplicates collapse with a
  count, and there's a **Copy log** button so the user can paste values back.
- When something's invisible/not-working on device, add a **one-shot, guarded**
  diagnostic (in `onMounted`, wrapped in try/catch) and ask the user to copy the
  log — far faster than guessing. Remove or quiet noisy logs before merge.

## TODO conventions (`docs/TODO.md`)

- Three sections: **Done** (checked, with a one-paragraph summary of what
  landed + key function names), **Next branch** (queued follow-ups), and
  **Housekeeping / ideas**.
- On finishing a feature, move it to Done and add any spawned ideas to Next
  branch. Use a scratch `docs/branch-plan-*.md` for an in-flight multi-task
  branch if helpful, and fold it back in before merge.

## Reference docs

- `docs/forecast-model.md` — the Price Mechanics / forecast model spec.
- `docs/TODO.md` — current backlog and what's been done.
