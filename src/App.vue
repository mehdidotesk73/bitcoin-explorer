<script setup lang="ts">
import { ref, computed, shallowRef, onMounted } from 'vue'
import {
  fetchDailyPrices,
  EARLIEST_MS,
  type PricePoint,
  type FetchProgress,
} from './api/bitcoin'
import { loadSupplemental } from './api/supplemental'
import { sma, bollinger } from './lib/indicators'
import PriceChart from './components/PriceChart.vue'
import { debugState, logDebug } from './debug'
import { setupPWAUpdates } from './pwa'

const CACHE_KEY = 'btc-daily-v1'

const buildId = __BUILD_ID__
const buildTime = __BUILD_TIME__
const showDebug = ref(false)

// Keep the installed PWA current: auto-reload on new deploys, plus a manual
// button as a guaranteed way to escape a stale cache.
const { reloadLatest } = setupPWAUpdates()

// --- Raw data + fetch state -------------------------------------------------
const raw = shallowRef<PricePoint[]>([])
const loading = ref(false)
const error = ref('')
const progress = ref<FetchProgress>({ bars: 0, pages: 0 })
const lastUpdated = ref<number | null>(null)

// --- Adjustable parameters --------------------------------------------------
const startDate = ref('') // data range start (empty = earliest available)
const maPeriod = ref(20)
const maUnit = ref<PeriodUnit>('day')
const bbPeriod = ref(20)
const bbUnit = ref<PeriodUnit>('day')
const bbK = ref(2)
const zoom = ref<[number, number]>([0, 100]) // graphed range, percent

// Data is daily, so week/month periods just scale the sample count.
type PeriodUnit = 'day' | 'week' | 'month'
const UNIT_DAYS: Record<PeriodUnit, number> = { day: 1, week: 7, month: 30 }
const UNIT_ABBR: Record<PeriodUnit, string> = { day: 'd', week: 'w', month: 'mo' }
const toDays = (period: number, unit: PeriodUnit) =>
  Math.max(1, Math.round(period * UNIT_DAYS[unit]))

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// Earliest available date drives the "Data start" picker's minimum.
const minDate = computed(() =>
  raw.value.length ? toDateInput(raw.value[0].time) : toDateInput(EARLIEST_MS),
)

// Combine supplemental (pre-2017) with Binance, one point per UTC day. Binance
// wins any overlapping day since it's the exchange source.
function merge(supp: PricePoint[], binance: PricePoint[]): PricePoint[] {
  const byDay = new Map<string, PricePoint>()
  for (const p of supp) byDay.set(dayKey(p.time), p)
  for (const p of binance) byDay.set(dayKey(p.time), p)
  return [...byDay.values()].sort((a, b) => a.time - b.time)
}

// --- Derived series (recomputed instantly on parameter change) --------------
const filtered = computed(() => {
  if (!raw.value.length) return []
  const startMs = startDate.value ? Date.parse(startDate.value) : raw.value[0].time
  return raw.value.filter((p) => p.time >= startMs)
})
const dates = computed(() => filtered.value.map((p) => toDateInput(p.time)))
const prices = computed(() => filtered.value.map((p) => p.price))

// Effective windows in days, and short labels for the chart legend/tooltip.
const maDays = computed(() => toDays(maPeriod.value, maUnit.value))
const bbDays = computed(() => toDays(bbPeriod.value, bbUnit.value))
const maLabel = computed(() => `${maPeriod.value}${UNIT_ABBR[maUnit.value]}`)
const bbLabel = computed(() => `${bbPeriod.value}${UNIT_ABBR[bbUnit.value]}`)

const ma = computed(() => sma(prices.value, maDays.value))
const bands = computed(() => bollinger(prices.value, bbDays.value, bbK.value))

const latestPrice = computed(() =>
  prices.value.length ? prices.value[prices.value.length - 1] : null,
)

// --- Graphed-range presets --------------------------------------------------
function setRange(days: number | 'all') {
  const n = filtered.value.length
  if (!n || days === 'all') {
    zoom.value = [0, 100]
    return
  }
  const start = Math.max(0, ((n - days) / n) * 100)
  zoom.value = [start, 100]
}

// --- Data loading -----------------------------------------------------------
function loadCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return
    const parsed = JSON.parse(cached) as { points: PricePoint[]; ts: number }
    if (Array.isArray(parsed.points) && parsed.points.length) {
      raw.value = parsed.points
      lastUpdated.value = parsed.ts
      if (!startDate.value) startDate.value = minDate.value
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
    if (!startDate.value) startDate.value = minDate.value
    logDebug(
      `loaded ${binance.length} Binance + ${supp.length} supplemental = ${points.length} points`,
    )
    lastUpdated.value = Date.now()
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ points, ts: lastUpdated.value }),
    )
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Failed to load price data. Check your connection.'
    logDebug(`refresh failed: ${error.value}`, 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadCache() // show cached data instantly (also works offline)
  refresh() // then fetch fresh in the background
})

const fmtUSD = (v: number | null) =>
  v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
</script>

<template>
  <main class="app">
    <header>
      <h1>₿ Bitcoin Price Explorer</h1>
      <p class="latest" v-if="latestPrice">
        Latest close: <strong>{{ fmtUSD(latestPrice) }}</strong>
        <span class="muted" v-if="lastUpdated">
          · updated {{ new Date(lastUpdated).toLocaleString() }}
        </span>
      </p>
    </header>

    <section class="status" v-if="loading">
      Loading daily prices… {{ progress.bars }} bars over {{ progress.pages }} page(s)
    </section>
    <section class="status error" v-else-if="error">
      ⚠️ {{ error }}
      <button @click="refresh">Retry</button>
    </section>

    <section class="controls">
      <label>
        Data start
        <input type="date" v-model="startDate" :min="minDate" :max="toDateInput(Date.now())" />
      </label>
      <label>
        MA period
        <span class="period">
          <input type="number" v-model.number="maPeriod" min="1" max="400" />
          <select v-model="maUnit">
            <option value="day">days</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
          </select>
        </span>
      </label>
      <label>
        Bollinger period
        <span class="period">
          <input type="number" v-model.number="bbPeriod" min="1" max="400" />
          <select v-model="bbUnit">
            <option value="day">days</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
          </select>
        </span>
      </label>
      <label>
        Bollinger σ ×
        <input type="number" v-model.number="bbK" min="0.5" max="5" step="0.5" />
      </label>
    </section>

    <section class="ranges">
      <span class="muted">Graphed range:</span>
      <button @click="setRange(30)">1M</button>
      <button @click="setRange(90)">3M</button>
      <button @click="setRange(365)">1Y</button>
      <button @click="setRange(365 * 3)">3Y</button>
      <button @click="setRange('all')">All</button>
    </section>

    <PriceChart
      v-if="dates.length"
      :dates="dates"
      :price="prices"
      :ma="ma"
      :upper="bands.upper"
      :lower="bands.lower"
      :ma-label="maLabel"
      :bb-label="bbLabel"
      v-model:zoom="zoom"
    />
    <p class="hint">
      Drag the slider under the chart (or pinch) to adjust the graphed range.
      Sources: CoinMarketCap (daily closes before Aug 2017) + Binance public
      market data (daily BTC/USDT closes from Aug 2017).
    </p>

    <footer class="debug">
      <button class="debug-toggle" @click="showDebug = !showDebug">
        build {{ buildId }} · {{ buildTime }}
        <span v-if="debugState.logs.some((l) => l.kind === 'error')" class="err-dot">
          ● {{ debugState.logs.filter((l) => l.kind === 'error').length }} error(s)
        </span>
        <span class="chev">{{ showDebug ? '▲' : '▼' }}</span>
      </button>
      <button class="reload-btn" @click="reloadLatest">Reload latest</button>
      <ul v-if="showDebug" class="debug-log">
        <li v-if="!debugState.logs.length" class="muted">No log entries yet.</li>
        <li v-for="(l, i) in debugState.logs" :key="i" :class="l.kind">
          <span class="muted">{{ l.time }}</span> {{ l.msg }}
        </li>
      </ul>
    </footer>
  </main>
</template>

<style scoped>
.app {
  max-width: 60rem;
  margin: 0 auto;
  padding: max(1rem, env(safe-area-inset-top)) 1rem 2rem;
}
header h1 {
  font-size: 1.4rem;
  margin: 0 0 0.25rem;
}
.latest {
  margin: 0 0 0.75rem;
}
.muted {
  color: #888;
  font-weight: 400;
  font-size: 0.85rem;
}
.status {
  padding: 0.6rem 0.8rem;
  background: #f3f4f6;
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}
.status.error {
  background: #fde8e8;
}
.controls,
.ranges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.75rem;
}
.controls label {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: #555;
  gap: 0.2rem;
}
.controls input {
  font: inherit;
  padding: 0.35rem 0.4rem;
  border: 1px solid #ccc;
  border-radius: 0.4rem;
  width: 8rem;
}
.period {
  display: flex;
  gap: 0.3rem;
}
.period input {
  width: 4rem;
}
.period select {
  font: inherit;
  padding: 0.35rem 0.3rem;
  border: 1px solid #ccc;
  border-radius: 0.4rem;
}
button {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid #42b883;
  background: #fff;
  color: #369b6f;
  border-radius: 0.4rem;
  cursor: pointer;
}
button:hover {
  background: #42b883;
  color: #fff;
}
.hint {
  color: #888;
  font-size: 0.8rem;
  margin-top: 0.75rem;
}
.debug {
  margin-top: 1.5rem;
  border-top: 1px solid #eee;
  padding-top: 0.5rem;
}
.debug-toggle {
  border: none;
  background: none;
  color: #999;
  font-size: 0.72rem;
  padding: 0.2rem 0;
  cursor: pointer;
}
.debug-toggle:hover {
  background: none;
  color: #555;
}
.err-dot {
  color: #c0392b;
  margin-left: 0.4rem;
}
.reload-btn {
  margin-left: 0.6rem;
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
}
.chev {
  margin-left: 0.3rem;
}
.debug-log {
  list-style: none;
  padding: 0.5rem;
  margin: 0.4rem 0 0;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0.4rem;
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  line-height: 1.5;
  max-height: 12rem;
  overflow: auto;
}
.debug-log .error {
  color: #fca5a5;
}
</style>
