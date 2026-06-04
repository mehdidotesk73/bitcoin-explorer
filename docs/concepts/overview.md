# Bitcoin Price Explorer — overview

This app explores Bitcoin's **daily** closing price three ways. It is a
client-side single-page app: all maths runs in the browser over an
already-fetched price array, so every knob recomputes instantly with no refetch.

## The three tabs

- **Price Explorer** — the raw price plus toggleable technical metrics (moving
  average, Bollinger bands, run detection) and derived curves (price ÷ MA,
  Bollinger score, run slope). A descriptive lens on history.
- **Price Mechanics** — a structured *what-if* forecast engine. It splits price
  into a slow "value" baseline (a long moving average) and a "volatility"
  multiplier, fits growth/volatility/peak models to history, and projects
  forward to a chosen horizon.
- **Hodl Explorer** — a buying-strategy sandbox. Build buy-day "seed layers"
  from tunable pattern pickers (price ÷ MA, Bollinger score, uniform spacing,
  manual dates), then simulate the resulting position and compare it against a
  buy-every-day baseline over the same budget and window.

## Data

- **Source:** Binance public daily BTC/USDT closes (Aug 2017 →), prepended with
  CoinMarketCap-sourced daily closes for the pre-2017 history. Merged into one
  continuous daily series; Binance wins on any overlap.
- **Caching:** the merged series is cached in `localStorage`, so the app opens
  instantly (and offline) on the last-known data, then refreshes in the
  background.
- **Shape:** each point is `{ time (epoch ms, UTC), price (USD close) }`.

## Principles that hold across every tab

- **Causality.** Every indicator and decision for day *i* uses only data at days
  **≤ i** — trailing averages, trailing windows, past-only smoothing. Nothing
  peeks into the future.
- **Heuristics, not advice.** Moving averages, bands, runs, the Bollinger score,
  and the forecast curves are *descriptive tools*, not predictions or financial
  advice. Bitcoin is **not guaranteed** to repeat its historical or current
  patterns.
- **Pure functions.** The analytics live in `src/lib/` (`indicators.ts`,
  `runs.ts`, `forecast.ts`, `hodl.ts`) as plain functions over arrays; the Vue
  components stay thin.

## Shared state

The **long-MA window** (default ~4 years / 1460 days) is shared between the
Price Explorer and the Hodl Explorer, so the "value baseline" you tune in one
tab matches the other.

## Staying on the latest version

This is an installable web app (PWA), so your phone caches it to open instantly
and work offline. The footer shows the running **build** stamp and, when the
live site has a newer build, an **Update ready — Reload** prompt. Tapping it
fully clears the cached app and reloads the latest version from the network
(otherwise the cache can keep serving the old build). If a change still doesn't
appear, open the site in a **private/incognito tab** — that always bypasses the
cache.
