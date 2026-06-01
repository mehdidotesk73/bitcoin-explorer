// Pure functions for the chart's technical indicators. They run client-side
// over the already-fetched price series, so changing a parameter recomputes
// instantly without re-fetching.

/**
 * Simple moving average over `period` samples. The first `period - 1` entries
 * are `null` (not enough history yet) so the output aligns 1:1 with the input.
 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (period <= 0) return out
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export interface BollingerBands {
  middle: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
}

/**
 * Bollinger Bands: a `period`-SMA middle band with upper/lower bands at
 * `k` population standard deviations away.
 */
export function bollinger(
  values: number[],
  period: number,
  k: number,
): BollingerBands {
  const middle = sma(values, period)
  const upper: (number | null)[] = new Array(values.length).fill(null)
  const lower: (number | null)[] = new Array(values.length).fill(null)

  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i]
    if (mean == null) continue
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean
      sq += d * d
    }
    const sd = Math.sqrt(sq / period)
    upper[i] = mean + k * sd
    lower[i] = mean - k * sd
  }

  return { middle, upper, lower }
}

// ---------------------------------------------------------------------------
// M/W price-heat indicator (soft Bollinger band-relative trend field)
// ---------------------------------------------------------------------------
//
// Rather than precisely matching double-top/double-bottom shapes, this scores a
// continuous, signed "temperature" for every sample from smooth proximity
// functions — so approximate W/M structure registers proportionally:
//
//   W-side (bullish, +, cool): price scooping into a trough while sitting low
//     in the Bollinger envelope.
//   M-side (bearish, -, hot):  price arching into a peak while sitting high in
//     the envelope.
//
// See `mwHeat` for the three soft ingredients (band position, scoop, pairing).

export interface MWHeatOptions {
  /** Neighbourhood half-width (samples) for the scoop/pairing smoothing. */
  pivotWindow?: number
  /** Reserved: soft level tolerance (currently unused by the soft field). */
  levelTolerance?: number
}

export interface MWPattern {
  type: 'W' | 'M'
  first: number
  neck: number
  second: number
  score: number
}

export interface MWHeatResult {
  /** Signed heat per sample in [-1, +1]: +cool (W / bottoming) … -hot (M / topping). */
  heat: number[]
  /** Discrete patterns (unused by the soft field; kept for API stability). */
  patterns: MWPattern[]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** Gaussian-weighted smoothing of a series (σ ≈ `radius`/2, truncated at ±2σ). */
function gaussianSmooth(values: number[], radius: number): number[] {
  const sigma = Math.max(0.5, radius / 2)
  const r = Math.max(1, Math.ceil(sigma * 2))
  const wts: number[] = []
  for (let d = -r; d <= r; d++) wts.push(Math.exp(-(d * d) / (2 * sigma * sigma)))
  const out = new Array(values.length).fill(0)
  for (let i = 0; i < values.length; i++) {
    let acc = 0
    let sw = 0
    for (let d = -r; d <= r; d++) {
      const j = i + d
      if (j < 0 || j >= values.length) continue
      acc += wts[d + r] * values[j]
      sw += wts[d + r]
    }
    out[i] = sw > 0 ? acc / sw : 0
  }
  return out
}

/**
 * Soft M/W "price-heat": a continuous trend field rather than precise pattern
 * matching. Every sample gets a signed likelihood in [-1, +1] — cool (+, W /
 * bottoming) … hot (-, M / topping) — built from smooth proximity functions, so
 * approximate shapes register proportionally instead of passing/failing a test:
 *
 *   • band position — a continuous tanh of %B (how near the lower vs upper
 *     band), instead of a hard "did it pierce the band" check.
 *   • scoop — a Gaussian-weighted measure of the area between the price and its
 *     local neighbourhood (>0 trough, <0 peak), instead of strict pivots.
 *   • pairing — the trough/peak field is Gaussian-smoothed so nearby dips (or
 *     peaks) reinforce into a soft "double" structure, with no level-match gate.
 *
 * Samples without a full band (warm-up) contribute 0.
 */
export function mwHeat(
  price: number[],
  bands: BollingerBands,
  opts: MWHeatOptions = {},
): MWHeatResult {
  const n = price.length
  const w = Math.max(2, Math.round(opts.pivotWindow ?? 6))
  const heat = new Array(n).fill(0)
  const patterns: MWPattern[] = []
  if (n === 0) return { heat, patterns }

  // Gaussian neighbourhood weights (excluding the centre) for the soft scoop.
  const sigma = Math.max(1, w / 2)
  const offs: number[] = []
  const wts: number[] = []
  for (let d = -w; d <= w; d++) {
    if (d === 0) continue
    offs.push(d)
    wts.push(Math.exp(-(d * d) / (2 * sigma * sigma)))
  }

  const bandSignal = new Array(n).fill(0) // +cool (near lower) … -hot (near upper)
  const scoop = new Array(n).fill(0) // +trough … -peak (soft, normalized)

  for (let i = 0; i < n; i++) {
    const u = bands.upper[i]
    const l = bands.lower[i]
    if (u == null || l == null || u <= l) continue
    const width = u - l
    const pctB = (price[i] - l) / width
    // Continuous & bounded: 0.5 → 0, lower band → +, upper band → -.
    bandSignal[i] = Math.tanh(3 * (0.5 - pctB))

    // Soft scoop ≈ area between the price and its neighbourhood, normalized by
    // half the band width. Positive when neighbours sit higher (a trough).
    let acc = 0
    let sw = 0
    for (let k = 0; k < offs.length; k++) {
      const j = i + offs[k]
      if (j < 0 || j >= n) continue
      acc += wts[k] * (price[j] - price[i])
      sw += wts[k]
    }
    if (sw > 0) scoop[i] = Math.tanh(acc / sw / (0.5 * width))
  }

  // A trough sitting low in the band is bullish (cool); a peak sitting high is
  // bearish (hot). Both factors are continuous likelihoods in [0, 1].
  const boost = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    const trough = Math.max(0, scoop[i])
    const peak = Math.max(0, -scoop[i])
    const cool = Math.max(0, bandSignal[i])
    const hot = Math.max(0, -bandSignal[i])
    boost[i] = trough * cool - peak * hot
  }
  // Smooth so nearby troughs/peaks reinforce (soft "double" structure) and the
  // heat spreads across spans instead of spiking at single samples.
  const smoothed = gaussianSmooth(boost, w)

  for (let i = 0; i < n; i++) {
    heat[i] = clamp(0.7 * bandSignal[i] + 1.4 * smoothed[i], -1, 1)
  }

  return { heat, patterns }
}
