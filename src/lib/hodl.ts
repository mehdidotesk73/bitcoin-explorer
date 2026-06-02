/**
 * Hodl Explorer simulation engine.
 *
 * Pure functions over price arrays — no side effects, no data fetching.
 * All decisions are causal: day i is computed from data at indices ≤ i only.
 */

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
  /** Fraction of total days that were buy days (numBuys / total days). */
  coverage: number
  /** Total budget deployed (equal on both sides — used for ROI). */
  totalSpent: number
}

/**
 * Select buy dates where price / longMA < threshold.
 * longMA must already be computed causally (sma at each i uses only data ≤ i).
 * Returns the array indices of qualifying days.
 */
export function selectRatioBuyDates(
  price: number[],
  longMa: (number | null)[],
  threshold: number,
): number[] {
  const dates: number[] = []
  for (let i = 0; i < price.length; i++) {
    const m = longMa[i]
    if (m != null && m > 0 && price[i] / m < threshold) {
      dates.push(i)
    }
  }
  return dates
}

/**
 * Simulate the strategy: buy equally on each of the given date indices,
 * spending a total budget of 1 unit (scale-free). Value at the final price.
 *
 * Returns null if no qualifying buy dates exist.
 */
export function simulateStrategy(
  price: number[],
  buyIndices: number[],
  budget: number = 1,
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
  return {
    currentValue,
    roi,
    costBasis,
    btcAccumulated: btc,
    numBuys: buyIndices.length,
    coverage: buyIndices.length / price.length,
    totalSpent: budget,
  }
}

/**
 * Simulate the baseline: buy equally on every day in the trailing X days
 * (counted back from the last data point = "today").
 *
 * Returns null if baselineDays <= 0 or no data.
 */
export function simulateBaseline(
  price: number[],
  baselineDays: number,
  budget: number = 1,
): HodlStats | null {
  const n = price.length
  if (!n || baselineDays <= 0) return null
  const start = Math.max(0, n - baselineDays)
  const indices: number[] = []
  for (let i = start; i < n; i++) indices.push(i)
  return simulateStrategy(price, indices, budget)
}
