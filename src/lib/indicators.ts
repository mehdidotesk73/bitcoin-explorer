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
// M/W price-heat indicator (Bollinger band-relative double tops / bottoms)
// ---------------------------------------------------------------------------
//
// W-bottom (bullish): two swing lows at similar price, where the FIRST dips
// below the lower Bollinger band and the SECOND holds inside it — Bollinger's
// classic "W-Bottom". Pushes the heat score toward +1 (cool).
//
// M-top (bearish): the mirror — two swing highs, the FIRST poking above the
// upper band and the SECOND staying inside. Pushes the score toward -1 (hot).
//
// The per-pattern strength is spread across the span between the two pivots and
// accumulated into a signed series in [-1, +1], so the price line can be tinted
// cool where W-bottoms dominate and hot where M-tops dominate.

export interface MWHeatOptions {
  /** Half-width (in samples) of the local window used to find swing pivots. */
  pivotWindow?: number
  /** Max relative gap between the two extremes to count as a pair (e.g. 0.05). */
  levelTolerance?: number
}

export interface MWPattern {
  type: 'W' | 'M'
  /** Sample indices of the first pivot, neckline, and second pivot. */
  first: number
  neck: number
  second: number
  /** Signed strength: positive for W (bullish), negative for M (bearish). */
  score: number
}

export interface MWHeatResult {
  /** Signed heat per sample in [-1, +1]: +cool (W) … -hot (M). */
  heat: number[]
  /** The detected patterns (for markers/tooltips/debugging). */
  patterns: MWPattern[]
}

/** Indices that are a local min (`dir=-1`) or max (`dir=+1`) over ±`w`. */
function findPivots(values: number[], w: number, dir: 1 | -1): number[] {
  const out: number[] = []
  for (let i = w; i < values.length - w; i++) {
    const v = values[i]
    let isPivot = true
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue
      // Strictly more extreme neighbours disqualify; ties on one side are fine.
      if (dir === -1 ? values[j] < v : values[j] > v) {
        isPivot = false
        break
      }
    }
    if (isPivot) out.push(i)
  }
  return out
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/**
 * Detect Bollinger band-relative W-bottoms and M-tops and render a signed
 * per-sample heat series. Samples without a full band (warm-up) contribute 0.
 */
export function mwHeat(
  price: number[],
  bands: BollingerBands,
  opts: MWHeatOptions = {},
): MWHeatResult {
  const n = price.length
  const w = Math.max(1, opts.pivotWindow ?? 6)
  const tol = opts.levelTolerance ?? 0.15
  const heat = new Array(n).fill(0)
  const patterns: MWPattern[] = []
  if (n === 0) return { heat, patterns }

  // %B band position per sample: 0 at the lower band, 1 at the upper band.
  const pctB: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const u = bands.upper[i]
    const l = bands.lower[i]
    if (u == null || l == null || u <= l) continue
    pctB[i] = (price[i] - l) / (u - l)
  }

  // Continuous base heat: near the lower band → +1 (cool / W side), near the
  // upper band → -1 (hot / M side). This always varies, so the tint can't
  // silently collapse to neutral when no discrete pattern is found.
  for (let i = 0; i < n; i++) {
    if (pctB[i] != null) heat[i] = clamp(1 - 2 * (pctB[i] as number), -1, 1)
  }

  const lows = findPivots(price, w, -1)
  const highs = findPivots(price, w, 1)

  // --- W-bottoms: two similar swing lows, at least one near the lower band ---
  for (let a = 0; a < lows.length - 1; a++) {
    const i1 = lows[a]
    const i2 = lows[a + 1]
    const b1 = pctB[i1]
    const b2 = pctB[i2]
    if (b1 == null || b2 == null) continue
    const rel = Math.abs(price[i2] - price[i1]) / Math.max(price[i1], 1e-9)
    if (rel > tol) continue
    // At least one low must sit in the lower third of the band envelope.
    const lowB = Math.min(b1, b2)
    if (lowB > 0.33) continue
    let neck = i1
    for (let j = i1 + 1; j < i2; j++) if (price[j] > price[neck]) neck = j
    const score = clamp((0.33 - lowB) / 0.33, 0, 1) * (1 - rel / tol)
    if (score <= 0) continue
    patterns.push({ type: 'W', first: i1, neck, second: i2, score })
  }

  // --- M-tops: two similar swing highs, at least one near the upper band ---
  for (let a = 0; a < highs.length - 1; a++) {
    const i1 = highs[a]
    const i2 = highs[a + 1]
    const b1 = pctB[i1]
    const b2 = pctB[i2]
    if (b1 == null || b2 == null) continue
    const rel = Math.abs(price[i2] - price[i1]) / Math.max(price[i1], 1e-9)
    if (rel > tol) continue
    const highB = Math.max(b1, b2)
    if (highB < 0.67) continue
    let neck = i1
    for (let j = i1 + 1; j < i2; j++) if (price[j] < price[neck]) neck = j
    const score = clamp((highB - 0.67) / 0.33, 0, 1) * (1 - rel / tol)
    if (score <= 0) continue
    patterns.push({ type: 'M', first: i1, neck, second: i2, score })
  }

  // Detected patterns amplify the base heat across their span (toward ±1).
  for (const p of patterns) {
    const signed = (p.type === 'W' ? 1 : -1) * p.score
    for (let j = p.first; j <= p.second; j++) heat[j] = clamp(heat[j] + signed * 0.5, -1, 1)
  }

  return { heat, patterns }
}
