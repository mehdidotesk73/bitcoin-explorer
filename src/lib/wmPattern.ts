// W/M chart-pattern detector: double-bottom ("W") / double-top ("M") reversal
// patterns, ported from a reference pandas pipeline (resample → find swing
// pivots → match trough/peak quadruples → confirm the neckline breakout).
//
// Pipeline (mirrors the reference script's three phases):
//  1. `resampleLast` groups the daily series into fixed-size bars and keeps the
//     last close of each bar — daily data has no gaps, so grouping every
//     `timeframeDays` consecutive daily bars is equivalent to the reference's
//     pandas `resample(f"{days}D").last()`.
//  2. `findSwingPivots` scans the resampled bars for local highs/lows within a
//     `±lookbackBars` window.
//  3. `findEstablishedPatterns` matches trough-peak-trough-peak (W) or
//     peak-trough-peak-trough (M) quadruples whose two tops/bottoms agree
//     within `tolerance`, then scans the raw daily series after the fourth
//     pivot for the day price crosses the neckline (the middle pivot) —
//     the day the pattern "establishes".
//
// Caveat: unlike the other metrics in this file's siblings, swing-pivot
// detection is NOT causal — a pivot needs `lookbackBars` bars of hindsight to
// confirm, so a pivot near the right edge of the visible range can still
// disappear as new data arrives. Only the "established" breakout day is
// causal at the moment it fires (it only ever looks at data ≤ that day).

/** One of a pattern's four swing pivots. */
export interface WmPoint {
  origIdx: number // index into the daily `price`/`dates` arrays
  price: number
  type: 'peak' | 'trough'
}

export interface WmPattern {
  type: 'M' | 'W' // M = double top (bearish), W = double bottom (bullish)
  points: [WmPoint, WmPoint, WmPoint, WmPoint] // P1..P4, in daily order
  necklineLevel: number // P3's price — the breakout threshold
  establishedIdx: number // daily index of the confirming breakout close
  establishedPrice: number
}

export interface WmParams {
  timeframeDays: number // bar size the swings are measured on
  lookbackBars: number // bars required on each side to confirm a swing pivot
  tolerance: number // max relative difference allowed between the two tops/bottoms (0.04 = 4%)
}

export const DEFAULT_WM_PARAMS: WmParams = {
  timeframeDays: 30,
  lookbackBars: 2,
  tolerance: 0.04,
}

/** Daily index of the last bar in each `days`-sized consecutive block. */
function resampleLast(n: number, days: number): number[] {
  const idx: number[] = []
  for (let start = 0; start < n; start += days) idx.push(Math.min(start + days - 1, n - 1))
  return idx
}

/** Local highs/lows in the resampled series within a `±lookbackBars` window. */
function findSwingPivots(resampled: number[], origIdx: number[], lookbackBars: number): WmPoint[] {
  const pivots: WmPoint[] = []
  const n = resampled.length
  for (let i = lookbackBars; i < n - lookbackBars; i++) {
    const cur = resampled[i]
    let winMax = -Infinity
    let winMin = Infinity
    for (let j = i - lookbackBars; j <= i + lookbackBars; j++) {
      if (resampled[j] > winMax) winMax = resampled[j]
      if (resampled[j] < winMin) winMin = resampled[j]
    }
    if (cur === winMax) {
      if (cur > resampled[i - 1] || cur > resampled[i + 1])
        pivots.push({ origIdx: origIdx[i], price: cur, type: 'peak' })
    } else if (cur === winMin) {
      if (cur < resampled[i - 1] || cur < resampled[i + 1])
        pivots.push({ origIdx: origIdx[i], price: cur, type: 'trough' })
    }
  }
  return pivots
}

/** Match M/W quadruples in the pivot sequence and confirm each neckline breakout. */
function findEstablishedPatterns(
  pivots: WmPoint[],
  price: number[],
  tolerance: number,
): WmPattern[] {
  const out: WmPattern[] = []
  for (let i = 0; i < pivots.length - 3; i++) {
    const [p1, p2, p3, p4] = [pivots[i], pivots[i + 1], pivots[i + 2], pivots[i + 3]]

    if (p1.type === 'trough' && p2.type === 'peak' && p3.type === 'trough' && p4.type === 'peak') {
      const topDiff = Math.abs(p2.price - p4.price) / Math.max(p2.price, p4.price)
      if (topDiff > tolerance) continue
      const neckline = p3.price
      for (let d = p4.origIdx; d < price.length; d++) {
        if (price[d] < neckline) {
          out.push({
            type: 'M',
            points: [p1, p2, p3, p4],
            necklineLevel: neckline,
            establishedIdx: d,
            establishedPrice: price[d],
          })
          break
        }
      }
    } else if (
      p1.type === 'peak' &&
      p2.type === 'trough' &&
      p3.type === 'peak' &&
      p4.type === 'trough'
    ) {
      const bottomDiff = Math.abs(p2.price - p4.price) / Math.max(p2.price, p4.price)
      if (bottomDiff > tolerance) continue
      const neckline = p3.price
      for (let d = p4.origIdx; d < price.length; d++) {
        if (price[d] > neckline) {
          out.push({
            type: 'W',
            points: [p1, p2, p3, p4],
            necklineLevel: neckline,
            establishedIdx: d,
            establishedPrice: price[d],
          })
          break
        }
      }
    }
  }
  return out
}

/** Bar-group the series and find its swing pivots (shared by both exports below). */
function computePivots(price: number[], timeframeDays: number, lookbackBars: number): WmPoint[] {
  const n = price.length
  if (n === 0) return []
  const days = Math.max(1, Math.round(timeframeDays))
  const lookback = Math.max(1, Math.round(lookbackBars))

  const origIdx = resampleLast(n, days)
  const resampled = origIdx.map((i) => price[i])
  if (resampled.length < 2 * lookback + 1) return []

  return findSwingPivots(resampled, origIdx, lookback)
}

/**
 * The raw swing pivots (all peaks/troughs, not just ones that form a matched
 * M/W quadruple) — a diagnostic view of what `detectWmPatterns` is working
 * from, useful for seeing why a bar-size/window choice finds few or no
 * patterns.
 */
export function detectSwingPivots(
  price: number[],
  params: Partial<Pick<WmParams, 'timeframeDays' | 'lookbackBars'>> = {},
): WmPoint[] {
  const timeframeDays = params.timeframeDays ?? DEFAULT_WM_PARAMS.timeframeDays
  const lookbackBars = params.lookbackBars ?? DEFAULT_WM_PARAMS.lookbackBars
  return computePivots(price, timeframeDays, lookbackBars)
}

/** Detect established M/W patterns in a daily `price` series. */
export function detectWmPatterns(price: number[], params: Partial<WmParams> = {}): WmPattern[] {
  const P: WmParams = { ...DEFAULT_WM_PARAMS, ...params }
  const tolerance = Math.max(0, P.tolerance)

  const pivots = computePivots(price, P.timeframeDays, P.lookbackBars)
  if (pivots.length < 4) return []

  return findEstablishedPatterns(pivots, price, tolerance)
}
