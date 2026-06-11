import simplify from 'simplify-js'

export interface SimplifyParams {
  /**
   * Approximate minimum **price move** (percent) a swing must clear to be kept —
   * the single "scale" dial. It's a heuristic label, not an exact filter: RDP
   * measures *perpendicular* distance (so steep spikes are kept a bit below this),
   * and it's relative to the series' full log-price range.
   */
  minMovePct: number
}

/**
 * Simplify a price series into a piecewise-linear skeleton via Ramer–Douglas–
 * Peucker (`simplify-js`), run in **normalized log-price** space so it's
 * scale-invariant across BTC's cents→$100k range. No pre-smoothing — the kept
 * vertices land on the **true price highs/lows** (the honest turning points a
 * later W/M detector needs).
 *
 * Returns a per-day array holding the price at each kept vertex and `null`
 * elsewhere — draw it with `connectNulls`, like the run skeleton.
 *
 * `minMovePct` maps to the internal RDP tolerance via the data's own log-range:
 * a kept swing deviates from the simplified line by ≳ `ln(1 + pct/100)` in
 * log-price, i.e. ~`pct`% in price.
 */
export function simplifyCurve(price: number[], params: SimplifyParams): (number | null)[] {
  const n = price.length
  const out = new Array<number | null>(n).fill(null)
  if (n === 0) return out

  const logp = price.map((v) => (v > 0 ? Math.log(v) : null))

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

  // A normalized vertical distance d ⇒ log move d·span ⇒ price ratio exp(d·span).
  // Pick the tolerance so that ratio = 1 + pct/100.
  const tolerance = Math.log(1 + Math.max(0, params.minMovePct) / 100) / span

  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const v = logp[i]
    if (v == null) continue
    pts.push({ x: i / denom, y: (v - lo) / span })
  }
  if (pts.length < 2) return out

  // highQuality = true → full Douglas–Peucker (no radial pre-pass), best fidelity.
  const kept = simplify(pts, tolerance, true)
  for (const k of kept) {
    const i = Math.round(k.x * denom)
    if (i >= 0 && i < n) out[i] = price[i]
  }
  return out
}
