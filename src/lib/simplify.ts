import simplify from 'simplify-js'
import { ema } from './indicators'

export interface SimplifyParams {
  /** EMA span (days) applied before simplifying; ≤ 1 = no smoothing. */
  smoothSpan: number
  /** RDP tolerance in normalized [0, 1] log-price space (≈ 0.002–0.08). Higher
   *  = fewer vertices. */
  tolerance: number
}

/**
 * Simplify a price series into a piecewise-linear skeleton via Ramer–Douglas–
 * Peucker (`simplify-js`), run in **normalized log-price** space so it's
 * scale-invariant across BTC's huge dynamic range (a fixed linear tolerance
 * would keep every recent wiggle and flatten all of early history).
 *
 * Returns a per-day array holding the (optionally smoothed) price at each kept
 * vertex and `null` elsewhere — draw it with `connectNulls`, like the run
 * skeleton. The kept vertices are the curve's turning points, a clean input for
 * later pattern detection.
 */
export function simplifyCurve(price: number[], params: SimplifyParams): (number | null)[] {
  const n = price.length
  const out = new Array<number | null>(n).fill(null)
  if (n === 0) return out

  // Optional causal pre-smooth, then move to log space.
  const src = params.smoothSpan > 1 ? ema(price, params.smoothSpan) : price
  const logp = src.map((v) => (v > 0 ? Math.log(v) : null))

  // Normalize x (index) and y (log price) to [0, 1] so RDP's perpendicular
  // distance is driven by curve *shape*, not by the raw index/price scales.
  let lo = Infinity
  let hi = -Infinity
  for (const v of logp) {
    if (v == null) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = hi - lo || 1
  const denom = n > 1 ? n - 1 : 1

  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const v = logp[i]
    if (v == null) continue
    pts.push({ x: i / denom, y: (v - lo) / span })
  }
  if (pts.length < 2) return out

  // highQuality = true → full Douglas–Peucker (no radial pre-pass), best fidelity.
  const kept = simplify(pts, params.tolerance, true)
  for (const k of kept) {
    const i = Math.round(k.x * denom)
    if (i >= 0 && i < n) out[i] = src[i]
  }
  return out
}
