// W/M pattern detection in **b-space** (the Bollinger score: MA = 0, ±kσ bands =
// ±1). A W is an ascending double-bottom, an M a descending double-top, each a
// 4-leg alternating sequence of turning points with region + level constraints:
//
//   W:  ▽ trough → lower band (b≈−1)   △ peak above MA   ▽ trough → MA (b≈0, higher low)   △ breakout
//   M:  △ peak   → upper band (b≈+1)   ▽ valley below MA  △ peak   → MA (b≈0, lower high)    ▽ breakdown
//
// We (1) reduce b to prominence-filtered turning points (a ZigZag so noise can't
// invent legs), then (2) score each candidate triple's three soft constraints —
// the two level *encroachments* and the middle leg's *region* — and combine them
// into a 0–1 confidence. "Encroachment" is the user's relative-distance measure:
// 1 when the turning point sits on the level, fading to 0 at distance `tol`.

export interface TurningPoint {
  index: number // day index in the source series
  b: number // Bollinger score at the extremum
  kind: 'trough' | 'peak'
}

export interface WMMatch {
  type: 'W' | 'M'
  start: number // day index of the pattern's lead-in
  end: number // day index of the breakout/breakdown
  confidence: number // 0–1
}

export interface WMParams {
  /** Min b-swing for a turning point to count (ZigZag threshold, b-units). */
  minProminence: number
  /** Encroachment tolerance: distance in b at which a level match fades to 0. */
  tol: number
  /** Keep matches at/above this confidence. */
  threshold: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
/** 1 on the level, → 0 at |b − target| = tol (the relative-distance measure). */
const encroach = (b: number, target: number, tol: number) => clamp01(1 - Math.abs(b - target) / tol)
/** Soft "above the MA": 0 at b ≤ −tol, 0.5 at the MA, 1 at b ≥ tol. */
const aboveMA = (b: number, tol: number) => clamp01((b + tol) / (2 * tol))
const belowMA = (b: number, tol: number) => 1 - aboveMA(b, tol)
/** One-sided penalty for crossing to the wrong side of the MA (1 if on-side). */
const atLeastMA = (b: number, tol: number) => (b >= 0 ? 1 : clamp01(1 + b / tol))
const atMostMA = (b: number, tol: number) => (b <= 0 ? 1 : clamp01(1 - b / tol))
const gmean3 = (a: number, b: number, c: number) => Math.cbrt(a * b * c)

/**
 * Prominence-filtered turning points of `b` (a ZigZag): a new extremum is only
 * committed once `b` reverses by ≥ `minProminence` from the running extreme, so
 * the result is a clean alternating trough/peak sequence.
 */
export function turningPoints(b: (number | null)[], minProminence: number): TurningPoint[] {
  const pts: { i: number; v: number }[] = []
  for (let i = 0; i < b.length; i++) {
    const v = b[i]
    if (v != null) pts.push({ i, v })
  }
  const out: TurningPoint[] = []
  if (pts.length < 2) return out

  let dir = 0 // 0 undecided, 1 rising, −1 falling
  let maxIdx = 0
  let minIdx = 0
  for (let k = 1; k < pts.length; k++) {
    const v = pts[k].v
    if (v > pts[maxIdx].v) maxIdx = k
    if (v < pts[minIdx].v) minIdx = k
    if (dir >= 0 && pts[maxIdx].v - v >= minProminence) {
      // Reversal down. The seed extreme (dir still 0) just sets the trend — it's
      // a boundary, not an interior turning point — so only emit once a trend
      // has been established.
      if (dir !== 0) out.push({ index: pts[maxIdx].i, b: pts[maxIdx].v, kind: 'peak' })
      dir = -1
      minIdx = maxIdx // start tracking the next trough from the peak
    } else if (dir <= 0 && v - pts[minIdx].v >= minProminence) {
      if (dir !== 0) out.push({ index: pts[minIdx].i, b: pts[minIdx].v, kind: 'trough' })
      dir = 1
      maxIdx = minIdx // start tracking the next peak from the trough
    }
  }
  return out
}

/** Detect W and M patterns over a Bollinger-score series. */
export function detectWM(b: (number | null)[], params: WMParams): WMMatch[] {
  const { minProminence, tol, threshold } = params
  const tp = turningPoints(b, minProminence)
  const out: WMMatch[] = []
  if (tp.length < 3) return out

  const spanStart = (i: number) => (i - 1 >= 0 ? tp[i - 1].index : tp[i].index)
  const spanEnd = (i: number) => (i + 3 < tp.length ? tp[i + 3].index : tp[i + 2].index)

  for (let i = 0; i + 2 < tp.length; i++) {
    const a = tp[i]
    const mid = tp[i + 1]
    const c = tp[i + 2]

    if (a.kind === 'trough') {
      // W: trough(lower band) · peak(above MA) · trough(MA, higher low)
      const s1 = encroach(a.b, -1, tol)
      const s2 = aboveMA(mid.b, tol)
      const s3 = encroach(c.b, 0, tol) * atLeastMA(c.b, tol)
      const confidence = gmean3(s1, s2, s3)
      if (confidence >= threshold) {
        out.push({ type: 'W', start: spanStart(i), end: spanEnd(i), confidence })
      }
    } else {
      // M: peak(upper band) · valley(below MA) · peak(MA, lower high)
      const s1 = encroach(a.b, 1, tol)
      const s2 = belowMA(mid.b, tol)
      const s3 = encroach(c.b, 0, tol) * atMostMA(c.b, tol)
      const confidence = gmean3(s1, s2, s3)
      if (confidence >= threshold) {
        out.push({ type: 'M', start: spanStart(i), end: spanEnd(i), confidence })
      }
    }
  }
  return out
}
