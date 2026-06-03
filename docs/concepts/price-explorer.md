# Price Explorer

A descriptive lens on Bitcoin's price history. The default view is **price
only**; you switch on metrics individually, each with its own collapsible
config. Some metrics draw **on** the price chart (overlays); others draw as
**separate curves** in a collapsible panel below.

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
- **Bollinger score (b).** A band-position of the **smoothed** price against a
  *long, run-scale-linked* band (window = period × scale ≈ 620 d by default),
  normalised so `±1` are the ±2σ bands and `0` is the mean. Shaded by run
  direction. Its inputs are the run **scale** and the Bollinger **period** (it
  ignores the bands' unit and σ; `b ≈ 2·%B − 1` only when windows match).
- **%B (classic).** The textbook band position `(price − lower)/(upper − lower)`
  from its **own** Bollinger bands — independent **period / unit / σ** — so it
  reads 0 at the lower band, 0.5 at the MA, 1 at the upper. Added alongside the
  Bollinger score so the short, true %B can be compared against the long,
  smoothed run-scale version.
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

## Assumptions & caveats

- Indicators are **descriptive heuristics**, not signals or advice.
- Everything is **causal**: day *i* uses only data ≤ *i*.
- The run parameters (band period, smoothing/trend/vote windows) are
  **heuristic defaults**, not statistically optimised — tune by eye.
- Bollinger bands use the **population** σ (the technical-analysis convention).
- Daily data is assumed evenly spaced; there is no intraday detail.
