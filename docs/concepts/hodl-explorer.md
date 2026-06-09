# Hodl Explorer

A buying-strategy sandbox. You assemble a set of **buy days** from one or more
tunable pattern pickers, then simulate the resulting Bitcoin position and compare
it against a buy-every-day **baseline** — same total budget, same window — so the
comparison is purely about *which* days, not how much.

## Mental model

```
strategy = union of seed layers  →  buy equally on those days
baseline = buy equally on every day in the comparison window
both spend the same total budget
```

A **seed layer** is a frozen set of buy days produced by a **driver**. You tune a
driver, preview it live, then **Add layer** to commit it. The strategy is the
**union** of all committed layers. The comparison **window** decides which of
those days actually count.

## Buy / Hodl indicator (top card)

For **today's** price, each band-based pattern (price ÷ MA, Bollinger score) as
currently tuned reads **BUY** (today sits inside its accumulation band) or
**HODL** (outside), with an "N of M patterns say buy" summary. It is a thin first
cut — a future version can pool many market/macro patterns into a single
buy-vs-hodl score. Heuristic only, not advice.

## Drivers (tunable, pattern-based pickers)

- **Price ÷ MA** — buy days where price ÷ (long MA) falls inside a band
  `[lower, upper]` (default 0–1.5). The MA window is **shared with the Price
  Explorer**.
- **Bollinger score (b)** — buy days where the band position sits in
  `[lower, upper]` (default −2–0, i.e. at/below the MA). Same `bandPosition`
  engine as the Price Explorer, with the Hodl tab's **own** Window / Smoothing /
  σ knobs.
- **Uniform spaced** — buy every **X days** on a phase **offset** from today (for
  weekly spacing, a weekday picker). The pattern-free DCA-style control.
- **Manual seeding** — add specific dates by hand.

Indicator layers resolve their rule over **all history** at add-time and then
**freeze**; retuning the driver afterward never mutates a saved layer — it only
changes the live preview. Manual dates are stored as-is.

## Window & budget

- **Comparison window** — a toggle flips between **trailing** N days from today
  (default 3000) and an explicit **from → to** date range. The baseline and all
  layers operate inside this window.
- **Total budget** — a cash amount (defaults to the current BTC price). Each buy
  day gets `budget ÷ (unique strategy days)`; the baseline spreads the same total
  across every day in the window.
- **Out-of-window dates** — manual dates outside the window are kept on the layer
  but **ignored in the totals** (flagged, not blocking) until the window covers
  them.

## What it reports

Two side-by-side comparisons — **Strategy vs baseline** (saved layers) and
**Preview vs baseline** (the live builder, before you add it) — each showing
current value, ROI, cost basis, BTC held, and the **edge** vs baseline.

## How it works

- Drivers resolve to day indices via `selectBandBuyDates()`,
  `uniformSpacedDates()`, or manual `snapDateToIndex()`; layers are unioned by
  `unionIndices()` (all in `lib/hodl.ts`).
- `simulateStrategy()` buys an equal cash slice on each day at that day's close,
  then values the accumulated BTC at the latest price → value, ROI, cost basis
  (average buy price), BTC, and coverage (buy-days ÷ window-days).
- The buy days are causal: an indicator day *i* is decided from data ≤ *i*
  (trailing MA, monthly b).

## Navigating the charts

The price chart and the driver-metric chart move together. **Pan** by dragging,
**zoom** by pinching (phone) / scroll-wheel (desktop) or by dragging the **slider**
under the price chart. For the **crosshair / read-out**, press-and-hold then drag
on a phone (it stays put until you pan or tap away), or just hover on desktop —
the value lines up on the same date in both charts.

## Assumptions & caveats

- **Backtest, not a trading model:** buys execute at the exact daily close with
  **no fees, slippage, or market impact**, no reinvestment or rebalancing.
- **Equal weight per buy day** — the comparison isolates *timing*, not sizing.
- **The baseline is buy-everything** — it is a yardstick, not a realistic plan;
  beating it is the bar.
- **Pattern pickers are heuristics over history.** Bitcoin is **not guaranteed**
  to repeat past or present patterns — exploration, not advice.
