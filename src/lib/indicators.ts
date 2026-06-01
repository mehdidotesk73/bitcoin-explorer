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
// DCA exploration: uniform vs heat-driven dollar-cost averaging
// ---------------------------------------------------------------------------

export interface DcaResult {
  invested: number // total cash deployed
  btc: number // total BTC accumulated
  avgCost: number // average cost basis ($/BTC)
  finalValue: number // btc × last price
  roi: number // finalValue / invested − 1
  buys: number // number of buy events
}

export interface DcaCompare {
  uniform: DcaResult
  heat: DcaResult
  /** Reactiveness `k` that maximised the heat strategy's final value. */
  bestK: number
  /** Heat-strategy final value at `bestK` (the optimised upside). */
  bestValue: number
}

/**
 * Simulate DCA buying every `intervalDays`-th sample, deploying `totalBudget`
 * in total. The heat strategy scales each buy by `max(0, 1 + k·heat)` — more
 * when cool/blue (a W/low), less when hot/red — then renormalises so it spends
 * exactly the same total as the uniform strategy. Any difference is therefore
 * pure *timing*, not deploying more capital.
 */
export function simulateDca(
  prices: number[],
  heat: number[],
  intervalDays: number,
  totalBudget: number,
  k: number,
): DcaResult {
  const n = prices.length
  const step = Math.max(1, Math.round(intervalDays))
  const idx: number[] = []
  for (let i = 0; i < n; i++) if (i % step === 0 && prices[i] > 0) idx.push(i)
  if (idx.length === 0) {
    return { invested: 0, btc: 0, avgCost: 0, finalValue: 0, roi: 0, buys: 0 }
  }
  const weights = idx.map((i) => Math.max(0, 1 + k * (heat[i] ?? 0)))
  const wsum = weights.reduce((a, b) => a + b, 0) || 1
  let btc = 0
  let invested = 0
  for (let j = 0; j < idx.length; j++) {
    const spend = (totalBudget * weights[j]) / wsum
    btc += spend / prices[idx[j]]
    invested += spend
  }
  const lastPrice = prices[n - 1]
  const finalValue = btc * lastPrice
  return {
    invested,
    btc,
    avgCost: btc > 0 ? invested / btc : 0,
    finalValue,
    roi: invested > 0 ? finalValue / invested - 1 : 0,
    buys: idx.length,
  }
}

/** Compare uniform vs heat-driven DCA, and scan k ∈ [0, 3] for the best value. */
export function dcaCompare(
  prices: number[],
  heat: number[],
  intervalDays: number,
  totalBudget: number,
  k: number,
): DcaCompare {
  const uniform = simulateDca(prices, heat, intervalDays, totalBudget, 0)
  const heatRes = simulateDca(prices, heat, intervalDays, totalBudget, k)
  let bestK = 0
  let bestValue = uniform.finalValue
  for (let kk = 0; kk <= 3.0001; kk += 0.1) {
    const v = simulateDca(prices, heat, intervalDays, totalBudget, kk).finalValue
    if (v > bestValue) {
      bestValue = v
      bestK = Math.round(kk * 10) / 10
    }
  }
  return { uniform, heat: heatRes, bestK, bestValue }
}
