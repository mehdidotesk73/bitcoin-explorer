/**
 * Hodl Explorer simulation engine.
 *
 * Pure functions over price arrays — no side effects, no data fetching.
 * All decisions are causal: day i is computed from data at indices ≤ i only.
 */

/** Which metric drives the seeding of buy dates. */
export type DriverId = 'ratio' | 'bscore'

/** A buy band: the metric must fall within [lower, upper] (inclusive) to buy. */
export interface Band {
  lower: number
  upper: number
}

export interface HodlStats {
  /** Current total value of all BTC bought (at today's price). */
  currentValue: number
  /** ROI as a fraction: (currentValue − totalSpent) / totalSpent. */
  roi: number
  /** Average price paid per BTC (totalSpent / btcAccumulated). */
  costBasis: number
  /** Total BTC accumulated. */
  btcAccumulated: number
  /** Number of buy events that fired. */
  numBuys: number
  /** Fraction of the comparison window that were buy days. */
  coverage: number
  /** Total budget deployed (equal on both sides — used for ROI). */
  totalSpent: number
}

/** Which metric drives a seed layer. */
export type SeedKind = 'ratio' | 'bscore' | 'manual'

/**
 * One stored seed layer in the combinator. Every layer is a STATIC set of day
 * indices, resolved once when added and frozen thereafter — indicator layers
 * resolve their band over all history at add-time, manual layers store the
 * chosen dates. `kind`/`label` are display metadata. The window only filters
 * which stored days count; the final strategy is the union of all layers.
 */
export interface SeedLayer {
  id: string
  kind: SeedKind
  label: string
  dateIndices: number[]
}

/** Merge several index lists into one sorted, de-duplicated list. */
export function unionIndices(lists: number[][]): number[] {
  const set = new Set<number>()
  for (const list of lists) for (const i of list) set.add(i)
  return [...set].sort((a, b) => a - b)
}

/**
 * Snap an ISO date (YYYY-MM-DD) to the nearest day index in `dates`.
 * Daily data, so any intraday time collapses to the closest trading day.
 */
export function snapDateToIndex(dates: string[], iso: string): number | null {
  if (!dates.length || !iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < dates.length; i++) {
    const d = Math.abs(new Date(dates[i]).getTime() - t)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** price / longMa as a per-day series (null where the MA isn't defined yet). */
export function ratioSeries(price: number[], longMa: (number | null)[]): (number | null)[] {
  return price.map((p, i) => {
    const m = longMa[i]
    return m != null && m > 0 ? p / m : null
  })
}

/**
 * Indices of the trailing comparison window [n − windowDays, n).
 * This is the shared window both the strategy and the baseline buy within.
 */
export function windowIndices(n: number, windowDays: number): number[] {
  if (!n || windowDays <= 0) return []
  const start = Math.max(0, n - windowDays)
  const out: number[] = []
  for (let i = start; i < n; i++) out.push(i)
  return out
}

/**
 * Select buy days where the driver metric falls within the band [lower, upper],
 * restricted to the given candidate indices (the comparison window).
 */
export function selectBandBuyDates(
  metric: (number | null)[],
  band: Band,
  candidates: number[],
): number[] {
  const lo = Math.min(band.lower, band.upper)
  const hi = Math.max(band.lower, band.upper)
  const out: number[] = []
  for (const i of candidates) {
    const v = metric[i]
    if (v != null && v >= lo && v <= hi) out.push(i)
  }
  return out
}

/**
 * Simulate buying equally on each of the given date indices, spending a total
 * budget (scale-free default of 1 unit). Value at the final price.
 *
 * `coverageDenom` is the size of the comparison window — coverage is
 * numBuys / coverageDenom. Returns null if there are no buy dates.
 */
export function simulateStrategy(
  price: number[],
  buyIndices: number[],
  budget: number = 1,
  coverageDenom?: number,
): HodlStats | null {
  if (!buyIndices.length || !price.length) return null
  const latestPrice = price[price.length - 1]
  const perBuy = budget / buyIndices.length
  let btc = 0
  for (const i of buyIndices) {
    if (price[i] > 0) btc += perBuy / price[i]
  }
  const currentValue = btc * latestPrice
  const roi = (currentValue - budget) / budget
  const costBasis = budget / btc
  const denom = coverageDenom ?? price.length
  return {
    currentValue,
    roi,
    costBasis,
    btcAccumulated: btc,
    numBuys: buyIndices.length,
    coverage: denom > 0 ? buyIndices.length / denom : 0,
    totalSpent: budget,
  }
}
