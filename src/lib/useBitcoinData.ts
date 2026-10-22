import { ref, shallowRef } from 'vue'
import { fetchDailyPrices, EARLIEST_MS, type PricePoint, type FetchProgress } from '../api/bitcoin'
import { loadSupplemental } from '../api/supplemental'
import { loadSnapshot } from '../api/snapshot'
import { mergeDaily, topUpStart } from './btcSnapshot'
import { logDebug } from '../debug'

const CACHE_KEY = 'btc-daily-v1'
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Shared price-data loader. Shows cached data instantly (also works offline),
 * then refreshes in the background. Used by every tab.
 *
 * Refresh prefers the app-owned snapshot (btc-daily.json — live from the `data`
 * branch, else the copy bundled in this build) and fetches only the Binance days
 * after it ends — usually one request.
 * Without a snapshot it falls back to the CSV + full Binance history.
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
      const { points: snapshot, source } = await loadSnapshot()
      // Base history: the snapshot, else the committed CSV.
      const base = snapshot.length ? snapshot : await loadSupplemental()
      // Show the snapshot right away; the top-up below only adds recent days.
      if (snapshot.length) raw.value = mergeDaily(raw.value, snapshot)
      const start = topUpStart(snapshot, EARLIEST_MS)
      const binance = await fetchDailyPrices(start, (p) => (progress.value = p))
      const points = mergeDaily(base, binance)
      raw.value = points
      logDebug(
        snapshot.length
          ? `loaded ${source} snapshot ${snapshot.length} days (to ${day(snapshot[snapshot.length - 1].time)}) + ${binance.length} live = ${points.length} points`
          : `no snapshot: ${base.length} supplemental + ${binance.length} Binance = ${points.length} points`,
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
