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
