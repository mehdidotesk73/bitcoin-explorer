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
// M/W price-heat indicator (soft price-vs-MA oscillation matching)
// ---------------------------------------------------------------------------
//
// The patterns are defined by how price oscillates across its moving average:
//
//   M-top (bearish, -, hot):  price crosses ABOVE the MA, pulls back toward/
//     below it, pushes up a second time but weaker, then rolls over — two
//     humps above the MA with a dip between. Likely to drop → red.
//   W-bottom (bullish, +, cool): the mirror — price dips BELOW the MA, recovers
//     toward/above it, dips a second time but shallower, then turns up — two
//     troughs below the MA with a bump between → blue.
//
// Detection is intentionally soft: it works on a smoothed price-minus-MA
// oscillator (so sharp zigzags are tamed) and scores each point by the
// correlation of the surrounding window against an idealised double-bump
// template, weighted by amplitude. No hard crossing/level tests — closeness to
// the shape maps continuously to score.

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

/** Gaussian-weighted smoothing that skips NaN gaps (σ ≈ `radius`/2, ±2σ). */
function gaussianSmoothNaN(values: number[], radius: number): number[] {
  const sigma = Math.max(0.5, radius / 2)
  const r = Math.max(1, Math.ceil(sigma * 2))
  const wts: number[] = []
  for (let d = -r; d <= r; d++) wts.push(Math.exp(-(d * d) / (2 * sigma * sigma)))
  const out = new Array(values.length).fill(NaN)
  for (let i = 0; i < values.length; i++) {
    let acc = 0
    let sw = 0
    for (let d = -r; d <= r; d++) {
      const j = i + d
      if (j < 0 || j >= values.length) continue
      const v = values[j]
      if (Number.isNaN(v)) continue
      acc += wts[d + r] * v
      sw += wts[d + r]
    }
    if (sw > 0) out[i] = acc / sw
  }
  return out
}

/**
 * Soft M/W "price-heat" from how price oscillates across its moving average.
 *
 * Steps:
 *   1. oscillator o = (price − MA) / MA, then smoothed to tame sharp zigzags.
 *   2. for each sample, correlate the surrounding window of `o` against an
 *      idealised double-bump template (two humps with a central dip). A
 *      positive correlation with positive local amplitude = an M-top (two
 *      moves above the MA, second weaker) → negative/hot score; the mirror
 *      (two dips below the MA) = a W-bottom → positive/cool score.
 *   3. weight by local amplitude (so flat noise stays neutral) and smooth.
 *
 * `pivotWindow` sets the half-width of the matched window (and the oscillator
 * smoothing), i.e. roughly how long an M/W leg is expected to be.
 * Samples without an MA (warm-up) contribute 0.
 */
export function mwHeat(
  price: number[],
  bands: BollingerBands,
  opts: MWHeatOptions = {},
): MWHeatResult {
  const n = price.length
  const w = Math.max(3, Math.round(opts.pivotWindow ?? 6))
  const heat = new Array(n).fill(0)
  const patterns: MWPattern[] = []
  if (n === 0) return { heat, patterns }

  // 1. Oscillator: relative distance of price from its MA, then smoothed.
  const ma = bands.middle
  const raw = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    const m = ma[i]
    if (m != null && m > 0) raw[i] = (price[i] - m) / m
  }
  const osc = gaussianSmoothNaN(raw, Math.max(2, Math.round(w / 2)))

  // 2. Idealised W template over a ±w window: cos(4π·t) → high ends, two
  //    interior dips with a central bump. This is the W (double-bottom) profile;
  //    its inverse (negative correlation) is the M (double-top). Zero-mean.
  const half = w
  const span = 2 * half + 1
  const tmpl: number[] = []
  let tmean = 0
  for (let d = -half; d <= half; d++) {
    // cos(2π · 2 · t) gives two peaks across the window (t in [-0.5, 0.5]).
    const t = d / span
    const v = Math.cos(2 * Math.PI * 2 * t)
    tmpl.push(v)
    tmean += v
  }
  tmean /= span
  let tnorm = 0
  for (let k = 0; k < span; k++) {
    tmpl[k] -= tmean
    tnorm += tmpl[k] * tmpl[k]
  }
  tnorm = Math.sqrt(tnorm) || 1

  // Typical oscillator amplitude → normaliser so the amplitude weight is ~O(1).
  const absVals = osc.filter((v) => !Number.isNaN(v)).map(Math.abs).sort((a, b) => a - b)
  const ampScale = absVals.length ? (absVals[Math.floor(absVals.length * 0.8)] || 1e-6) : 1e-6

  const match = new Array(n).fill(0)
  for (let i = half; i < n - half; i++) {
    // Gather the window; bail if it straddles the MA warm-up gap.
    let ok = true
    let wmean = 0
    for (let d = -half; d <= half; d++) {
      const v = osc[i + d]
      if (Number.isNaN(v)) {
        ok = false
        break
      }
      wmean += v
    }
    if (!ok) continue
    wmean /= span

    // Normalised cross-correlation of the window against the template.
    let dot = 0
    let wnorm = 0
    for (let d = -half; d <= half; d++) {
      const x = osc[i + d] - wmean
      dot += x * tmpl[d + half]
      wnorm += x * x
    }
    wnorm = Math.sqrt(wnorm) || 1e-9
    const corr = dot / (wnorm * tnorm) // -1..1: +1 = W shape, -1 = M shape

    // Amplitude weight: flat/noisy windows (small oscillation) stay neutral.
    const amp = Math.tanh(Math.sqrt(wnorm / span) / ampScale)

    // corr>0 → matches the W template (two dips) → cool/positive (blue).
    // corr<0 → inverted template (two humps, M-top) → hot/negative (red).
    // Reinforce when the dips sit below the MA (W) / humps above it (M): for a
    // W (corr>0) a negative window-mean strengthens it, and vice-versa.
    const posBias = 0.5 + 0.5 * Math.tanh(-2 * Math.sign(corr) * (wmean / ampScale))
    match[i] = clamp(corr * amp * posBias, -1, 1)
  }

  // 3. Smooth the match field so the heat reads as coherent zones, not specks,
  //    then apply a punchy nonlinear gain so moderate matches saturate to a
  //    clearly visible colour (the chained weights above keep values small).
  const smoothed = gaussianSmoothNaN(
    match.map((v) => (Number.isNaN(v) ? 0 : v)),
    w,
  )
  for (let i = 0; i < n; i++) {
    const s = Number.isNaN(smoothed[i]) ? 0 : smoothed[i]
    // tanh(6·s) maps even a modest |s|≈0.25 to ~|0.9|, so colours read boldly.
    heat[i] = clamp(Math.tanh(6 * s), -1, 1)
  }

  return { heat, patterns }
}

// ---------------------------------------------------------------------------
// DCA exploration: heat-band buy-days vs buy-every-day, averaged over all
// possible start days
// ---------------------------------------------------------------------------
//
// A plan buys on every day whose M/W heat falls inside a band [center ± window]
// (no fixed schedule — the band defines the buy-days). For a plan *started* on
// day s, the budget is split equally across the buy-days in [s, today], so its
// return is scale-free:
//
//   ROI(s) = mean over buy-days j ≥ s of (lastPrice / price[j])  −  1
//
// Averaging ROI(s) over every start day s gives a robust effectiveness metric
// that doesn't depend on a single lucky start date.

export interface DcaBandResult {
  avgRoi: number // mean ROI across all start days
  buyDays: number // days whose heat is in the band
  coverage: number // buyDays / total valid days
}

export interface DcaBandCompare {
  band: DcaBandResult // heat-band strategy
  uniform: DcaBandResult // buy every day (baseline)
  edge: number // band.avgRoi − uniform.avgRoi
}

/**
 * Average-over-all-start-days ROI for a plan that buys only on days where
 * `isBuyDay[i]` is true, splitting its budget equally across the buy-days from
 * each start day to the end. Scale-free, so no budget argument is needed.
 */
function avgStartRoi(prices: number[], isBuyDay: boolean[]): DcaBandResult {
  const n = prices.length
  const lastPrice = n ? prices[n - 1] : 0
  let buyDays = 0
  let validDays = 0
  for (let i = 0; i < n; i++) {
    if (prices[i] > 0) validDays++
    if (isBuyDay[i]) buyDays++
  }
  if (buyDays === 0 || lastPrice <= 0) {
    return { avgRoi: 0, buyDays, coverage: validDays ? buyDays / validDays : 0 }
  }
  // Sweep start day s from the end: maintain suffix sum/count of the buy-day
  // price ratios (lastPrice/price[j]) for j ≥ s, accumulating ROI(s).
  let suffixSum = 0
  let suffixCount = 0
  let totalRoi = 0
  let starts = 0
  for (let s = n - 1; s >= 0; s--) {
    if (isBuyDay[s] && prices[s] > 0) {
      suffixSum += lastPrice / prices[s]
      suffixCount++
    }
    if (suffixCount > 0) {
      totalRoi += suffixSum / suffixCount - 1
      starts++
    }
  }
  return {
    avgRoi: starts ? totalRoi / starts : 0,
    buyDays,
    coverage: validDays ? buyDays / validDays : 0,
  }
}

/**
 * Compare a heat-band DCA plan (buy when heat ∈ [center − window, center +
 * window]) against buying every day, each scored by the average-over-all-
 * start-days ROI. Heat is +cool (W/low) … −hot (M/top), so a positive `center`
 * targets the blue/low days.
 */
export function dcaBandExplore(
  prices: number[],
  heat: number[],
  center: number,
  window: number,
): DcaBandCompare {
  const n = prices.length
  const lo = center - window
  const hi = center + window
  const inBand: boolean[] = new Array(n)
  const everyDay: boolean[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const h = heat[i] ?? 0
    inBand[i] = prices[i] > 0 && h >= lo && h <= hi
    everyDay[i] = prices[i] > 0
  }
  const band = avgStartRoi(prices, inBand)
  const uniform = avgStartRoi(prices, everyDay)
  return { band, uniform, edge: band.avgRoi - uniform.avgRoi }
}

export interface DcaSweepPoint {
  center: number // band centre
  avgRoi: number // band plan's average start-day ROI
  ratio: number // (1 + band ROI) / (1 + uniform ROI): >1 = beats buy-every-day
  coverage: number // fraction of days captured by the band
}

export interface DcaSweep {
  points: DcaSweepPoint[]
  uniformRoi: number // buy-every-day baseline ROI (for reference)
}

/**
 * Sweep the buy-band centre across [-1, 1] at a fixed `window`, returning the
 * average start-day ROI curve so the whole space of "which heat band to buy"
 * can be compared at a glance. `ratio` = growth-multiple vs buy-every-day
 * (>1 means the band beats buying every day), which is readable even when the
 * absolute ROIs are huge.
 */
export function dcaSweep(
  prices: number[],
  heat: number[],
  window: number,
  steps = 41,
): DcaSweep {
  const everyDay = prices.map((p) => p > 0)
  const uniformRoi = avgStartRoi(prices, everyDay).avgRoi
  const points: DcaSweepPoint[] = []
  for (let s = 0; s < steps; s++) {
    const center = -1 + (2 * s) / (steps - 1)
    const lo = center - window
    const hi = center + window
    const inBand = heat.map((h, i) => prices[i] > 0 && (h ?? 0) >= lo && (h ?? 0) <= hi)
    const r = avgStartRoi(prices, inBand)
    points.push({
      center,
      avgRoi: r.avgRoi,
      ratio: (1 + r.avgRoi) / (1 + uniformRoi || 1),
      coverage: r.coverage,
    })
  }
  return { points, uniformRoi }
}
