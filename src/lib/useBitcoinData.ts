import { ref, shallowRef } from 'vue'
import {
  fetchDailyPrices,
  EARLIEST_MS,
  type PricePoint,
  type FetchProgress,
} from '../api/bitcoin'
import { loadSupplemental } from '../api/supplemental'
import { logDebug } from '../debug'

const CACHE_KEY = 'btc-daily-v1'
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// Combine supplemental (pre-2017) with Binance, one point per UTC day. Binance
// wins any overlapping day since it's the exchange source.
function merge(supp: PricePoint[], binance: PricePoint[]): PricePoint[] {
  const byDay = new Map<string, PricePoint>()
  for (const p of supp) byDay.set(dayKey(p.time), p)
  for (const p of binance) byDay.set(dayKey(p.time), p)
  return [...byDay.values()].sort((a, b) => a.time - b.time)
}

/**
 * Shared price-data loader. Shows cached data instantly (also works offline),
 * then fetches fresh in the background. Used by every tab so the full daily
 * series is fetched and cached only once.
 */
export function useBitcoinData() {
  const raw = shallowRef<PricePoint[]>([])
  const loading = ref(false)
  const error = ref('')
  const progress = ref<FetchProgress>({ bars: 0, pages: 0 })
  const lastUpdated = ref<number | null>(null)

  function loadCache() {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (!cached) return
      const parsed = JSON.parse(cached) as { points: PricePoint[]; ts: number }
      if (Array.isArray(parsed.points) && parsed.points.length) {
        raw.value = parsed.points
        lastUpdated.value = parsed.ts
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  async function refresh() {
    loading.value = true
    error.value = ''
    progress.value = { bars: 0, pages: 0 }
    try {
      const [binance, supp] = await Promise.all([
        fetchDailyPrices(EARLIEST_MS, (p) => (progress.value = p)),
        loadSupplemental(),
      ])
      const points = merge(supp, binance)
      raw.value = points
      logDebug(
        `loaded ${binance.length} Binance + ${supp.length} supplemental = ${points.length} points`,
      )
      lastUpdated.value = Date.now()
      localStorage.setItem(CACHE_KEY, JSON.stringify({ points, ts: lastUpdated.value }))
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : 'Failed to load price data. Check your connection.'
      logDebug(`refresh failed: ${error.value}`, 'error')
    } finally {
      loading.value = false
    }
  }

  function init() {
    loadCache()
    refresh()
  }

  return { raw, loading, error, progress, lastUpdated, refresh, init }
}
