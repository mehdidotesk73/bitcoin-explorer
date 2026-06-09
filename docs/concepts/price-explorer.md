# Price Explorer

A descriptive lens on Bitcoin's price history. The default view is **price
only**; you switch on metrics individually from the **Metrics** menu, each with
its own config. The menu **starts collapsed** — tap it to expand and pick your
metrics, tap again to collapse (when folded it lists the active ones). Some
metrics draw **on** the price chart (overlays); others draw as **separate
curves** in a collapsible panel below.

## Mental model

Price is noisy. Each metric is a different *filter* that re-expresses the same
history so a particular behaviour stands out — a trend (moving average), a
volatility envelope (Bollinger bands), a sustained directional move (a "run"),
or how stretched price is from its long-term baseline (price ÷ MA).

## Overlays (drawn on the price chart)

- **Moving average (MA).** A simple rolling mean. Knob: **period** (default 20),
  selectable in days / weeks / months. A smoothed "where price has been."
- **Bollinger bands.** A middle MA with an upper/lower band at **k σ** away.
  Knobs: **period** (default 20) and **σ multiplier k** (default 2). The band
  widens with volatility; price riding the upper/lower edge signals
  stretched conditions.
- **Run detection.** Finds **runs** — maximal stretches where the trend is
  *sustained* in one direction — and draws a piecewise-linear skeleton over the
  price, each segment at that run's average pace. Choppy stretches break runs and
  are left blank. Knobs (shared with the run-derived curves):
  - **Scale** — a continuous, *logarithmic* window from ~1 to ~1500 days; the
    label snaps to a named scale (daily / weekly / monthly / seasonal / yearly /
    multi-year). Default ≈ 31 days.
  - **Sensitivity** — higher = more / longer runs (default 0.2). Internally it
    lowers the "sustainment" gate a stretch must clear to count as a run.

## Separate curves (collapsible panel below)

- **Price ÷ MA.** Price divided by a **long, slow** baseline MA (default ~4
  years), on a **log** axis. Above 1 = price is above its baseline; below 1 =
  oversold relative to baseline. The long window is what makes whole cycles
  legible instead of the ratio hugging 1.
- **Bollinger score.** A clean band-position metric:
  `b = (EMAₛ(price) − MA_W) / (k · σ_W)` over a single window `W`, centered at 0
  (`0` = on the MA, `±1` = the ±kσ bands). Three honest, independent knobs:
  - **Period** (days / weeks / months) — one lookback for the mean *and* σ
    (default 20 months).
  - **σ × (k)** — band width, independent of the period (default 2).
  - **Smoothing** (days, EMA on the price) — the main noise control, labelled by
    horizon (default 31 → "monthly · 31d"); 0 = none.

  It subsumes both earlier curves: **smoothing 0 + short window = classic %B**
  (just read as `(b+1)/2`); the long, smoothed defaults give the clean wave. Run
  direction is shaded behind it. (`b = 2·%B − 1` for any k.)
- **Run slope.** Each run's average daily % change, as bars coloured by
  direction (green up, red down, flat/0 = chop).

## How it works

- `sma()` and `bollinger()` (`lib/indicators.ts`) compute the MA and bands as
  pure rolling functions.
- `scaleDiag(price, hd)` (`lib/runs.ts`) is the run engine at one scale `hd`:
  it causally smooths price (EMA), expresses it in band-position space against a
  trailing Bollinger window, derives a trend operator and a sustained-trend
  "vote", then segments the vote into runs where it clears the sensitivity gate.
- The run slope is measured on the **smoothed** price the runs are built from
  (not raw endpoints), so the slope bars and the b-shading agree run-for-run.
- All panels share one x-zoom + crosshair group, so panning/zooming the price
  chart moves the curves in lockstep.

## Navigating the charts

The price chart and every separate curve move together — pan, zoom, and the
crosshair all line up on the same date across graphs.

- **Pan:** drag left/right.
- **Zoom:** pinch (phone) or scroll-wheel (desktop); or drag the **slider** under
  the price chart for an exact range. The quick-range buttons (1M / 3M / 1Y / 3Y /
  All) set the window directly.
- **Crosshair / read-out:** on a phone, **press-and-hold, then drag** — a
  crosshair follows your finger and the values line up across every graph; it
  stays put when you lift, until you pan or tap away. On desktop the crosshair
  just follows the mouse.

## Assumptions & caveats

- Indicators are **descriptive heuristics**, not signals or advice.
- Everything is **causal**: day *i* uses only data ≤ *i*.
- The run parameters (band period, smoothing/trend/vote windows) are
  **heuristic defaults**, not statistically optimised — tune by eye.
- Bollinger bands use the **population** σ (the technical-analysis convention).
- Daily data is assumed evenly spaced; there is no intraday detail.
