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

Every change — feature, fix, or tweak — goes through the **`ship-feature`** skill
(`.claude/skills/ship-feature/SKILL.md`). It's adapted from the template workflow at
https://github.com/mehdidotesk73/claude-nocode-netlify-webapp-workflow. In short:

1. **Branch** off the latest `main` as `claude/<feature>` (descriptive, not auto-generated) and
   verify the base (`git log --oneline origin/main..HEAD` empty).
2. **Small commits**, each preceded by the same checks CI runs: `npm run format:check`,
   `npm run test:run`, `npm run build`.
3. **Push, then open the PR immediately** — on the first push of the branch, not when the feature
   is finished. The PR is what makes Netlify build the Deploy Preview, and the preview is the only
   way the user (on their phone) sees the change.
4. **Give the user the preview link after every push**:
   `https://deploy-preview-<PR number>--bitcoin-analysis.netlify.app`, in a normal message (never
   inside an `AskUserQuestion` question — links arrive dead there), with what to check. Poll the
   PR's checks in-turn until the Netlify deploy resolves rather than scheduling a check-in.
5. **Pre-merge doc gate** when the branch is ready — see below.
6. **Hand over three links:** preview, live site (unchanged until merge), and the PR page to merge.
7. **The user merges**, never you. Merging to `main` runs the GitHub Pages production deploy; watch
   it and confirm the live site.

Two rules that hold regardless:

- **Never work on `main`.** It's protected; pushes are rejected.
- **A turn that pushes ends with the preview link.** They can't test what they can't find.

### Pre-merge doc gate — run this every time, do not skip

Four surfaces are the project's memory — keep the ones a branch touches current:

- **`docs/TODO.md`:** move finished items to Done (one-paragraph summary + key function names);
  queue follow-ups; record new placeholders/backlog.
- **`docs/experience.md`:** on every **merge**, a Version-history entry summarising the changes vs
  the previous version (added / removed / defaults / docs). On every **branch removal /
  abandonment**, a "What didn't work" entry — what was tried, whether we know _why_ it didn't work,
  and the reason (or honestly "direction felt unideal").
- **`docs/system-design.md`** (developer/system docs): if the branch changed architecture, a
  `lib`/module, a feature's design, or a convention, update the relevant section **and** the system
  map.
- **`docs/concepts/*.md`** (user/help docs, rendered in the Help modal): if the branch changed a
  page's UI or behaviour, update that page's doc.

When you judge a branch **ready to merge**, pose an `AskUserQuestion` with **`multiSelect: true`**
listing those four surfaces. **Recommend, don't quiz:** read the diff first, put the surfaces this
branch actually needs first with **(Recommended)**, and make each description name the specific
change that triggers it (or say plainly why it isn't needed). Selecting none = "keep working /
skip docs." Update exactly the selected docs, re-run the checks, push, then hand over the links.
Never declare a branch merge-ready without running this gate.

### Guided steps and gates

- When the user has to do something you can't see (test on the phone, merge, a settings page), say
  exactly what to tap and what success looks like, then end the turn on an `AskUserQuestion` with a
  one-line question — the instructions and links stay in the message body.
- Don't end a turn on "I'll check back in a few minutes" for a deploy that takes two; poll in-turn.

### Reverts / fixing main

- `main` is protected — **force-push is rejected**. To undo something on `main`,
  add a revert commit via a normal PR (revert the merge commit with `-m 1`), or
  push files through the GitHub MCP API. To re-introduce a reverted feature,
  "revert the revert" on a fresh branch (a plain re-merge won't work — Git sees
  it as already merged).
- Deleting/abandoning a branch → record it in `docs/experience.md` (above).

## Build & verify

- **Before every commit, run what CI runs:** `npm run format:check` (Prettier; `npm run format`
  fixes it), `npm run test:run` (Vitest, `src/lib/*.test.ts`), and `npm run build` (`vue-tsc -b &&
vite build` — catches TS errors _and_ Vue template parse errors). In a fresh container run
  `npm ci` first.
- **CI** (`.github/workflows/ci.yml`, job `build`) runs those same three on every PR into `main`.
  It's a backstop, not a substitute — a red check on the user's PR is noise they have to interpret.
- **Unit tests are added when a change earns them** — pure `src/lib/` logic that later features
  build on. See `ship-feature` step 3.
- The price API is **not reachable from this sandbox** (host allowlist), so you
  cannot run the live app or reproduce data-dependent results here. Reason about
  algorithms from the code, and lean on the user's on-device screenshots/logs to
  validate. Be honest about what you can't verify offline.

## Deploys

- **Production = GitHub Pages** (`https://mehdidotesk73.github.io/bitcoin-explorer/`), built by
  `.github/workflows/deploy.yml` on push to `main`. It bakes the repo name into the asset base
  path, so a repo rename needs a fresh deploy.
- **Netlify = preview only** (`netlify.toml`, site `bitcoin-analysis`) — every PR gets a Deploy
  Preview at `https://deploy-preview-<n>--bitcoin-analysis.netlify.app`. No PR, no preview.

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
    forecast.ts            forecast engine: fits + projection (see system-design.md §5.2)
  components/
    PriceExplorer.vue      Price Explorer tab: metric toggles + configs
    PriceChart.vue         echarts price chart + overlays (MA, Bollinger, runs)
    MetricsPanel.vue       collapsible separate-curve panel (ratio, b, run slope)
    ForecastView.vue       Price Mechanics tab (controls + params)
    ForecastChart.vue      echarts forecast chart
docs/
  TODO.md                  living backlog (Done / Next branch / Housekeeping)
  experience.md            what didn't work + per-merge version history
  system-design.md         developer/system docs (incl. forecast model §5.2)
  concepts/*.md            per-page user docs (rendered into the Help modal)
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

- `.claude/skills/ship-feature/SKILL.md` — the loop for every change.
- `docs/TODO.md` — current backlog and what's been done.
- `docs/experience.md` — dead ends (with reasons) + version history.
- `docs/system-design.md` — developer/system documentation; the forecast-model
  spec lives in §5.2 (other sections are placeholders, tracked in `TODO.md`).
- `docs/concepts/*.md` — per-page user docs, also rendered into the Help modal.
