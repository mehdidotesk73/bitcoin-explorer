// Pure functions for the chart's technical indicators. They run client-side
// over the already-fetched price series, so changing a parameter recomputes
// instantly without re-fetching.

/**
 * Causal (trailing) exponential moving average with the given `span` (in
 * samples). Seeded with the first value. `span ≤ 1` returns the input unchanged
 * (the smoothing coefficient becomes 1), so it doubles as a no-op at span 0.
 */
export function ema(values: number[], span: number): number[] {
  const n = values.length
  const out = new Array(n).fill(0)
  if (n === 0) return out
  const a = 2 / (Math.max(1, span) + 1)
  out[0] = values[0]
  for (let i = 1; i < n; i++) out[i] = a * values[i] + (1 - a) * out[i - 1]
  return out
}

/**
 * Centered band position (the clean "Bollinger score" family). For each day:
 *
 *     b = ( EMA_s(price) − SMA_W(price) ) / ( k · STD_W(price) )
 *
 * - `smoothSpan` (s): EMA span applied to the price (numerator); 0 = raw.
 * - `window` (W): one trailing window for the mean AND population std.
 * - `k`: independent σ-multiplier — `b = ±1` lands on the ±kσ bands.
 *
 * Centered at 0 (price on the mean), and `b = 2·%B − 1` for any k. `null` until
 * the window warms up or when σ is 0.
 */
export function bandPosition(
  values: number[],
  smoothSpan: number,
  window: number,
  k: number,
): (number | null)[] {
  const n = values.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (n === 0 || k <= 0) return out
  const w = Math.max(1, Math.round(window))
  const smoothed = ema(values, smoothSpan)
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    sum += values[i]
    sumSq += values[i] * values[i]
    if (i >= w) {
      sum -= values[i - w]
      sumSq -= values[i - w] * values[i - w]
    }
    if (i >= w - 1) {
      const mean = sum / w
      const sd = Math.sqrt(Math.max(0, sumSq / w - mean * mean))
      const denom = k * sd
      out[i] = denom > 0 ? (smoothed[i] - mean) / denom : null
    }
  }
  return out
}

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
