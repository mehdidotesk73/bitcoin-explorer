<script setup lang="ts">
import { ref, computed, shallowRef, onMounted } from 'vue'
import {
  fetchDailyPrices,
  EARLIEST_MS,
  type PricePoint,
  type FetchProgress,
} from './api/bitcoin'
import { sma, bollinger } from './lib/indicators'
import PriceChart from './components/PriceChart.vue'

const CACHE_KEY = 'btc-daily-v1'

// --- Raw data + fetch state -------------------------------------------------
const raw = shallowRef<PricePoint[]>([])
const loading = ref(false)
const error = ref('')
const progress = ref<FetchProgress>({ bars: 0, pages: 0 })
const lastUpdated = ref<number | null>(null)

// --- Adjustable parameters --------------------------------------------------
const startDate = ref(toDateInput(EARLIEST_MS)) // data range start
const maPeriod = ref(20)
const bbPeriod = ref(20)
const bbK = ref(2)
const zoom = ref<[number, number]>([0, 100]) // graphed range, percent

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
const minDate = toDateInput(EARLIEST_MS)

// --- Derived series (recomputed instantly on parameter change) --------------
const filtered = computed(() => {
  const startMs = Date.parse(startDate.value)
  return raw.value.filter((p) => p.time >= startMs)
})
const dates = computed(() => filtered.value.map((p) => toDateInput(p.time)))
const prices = computed(() => filtered.value.map((p) => p.price))
const ma = computed(() => sma(prices.value, Math.max(1, maPeriod.value)))
const bands = computed(() =>
  bollinger(prices.value, Math.max(1, bbPeriod.value), bbK.value),
)

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
    const points = await fetchDailyPrices(EARLIEST_MS, (p) => (progress.value = p))
    raw.value = points
    lastUpdated.value = Date.now()
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ points, ts: lastUpdated.value }),
    )
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Failed to load price data. Check your connection.'
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
        <input type="number" v-model.number="maPeriod" min="1" max="400" />
      </label>
      <label>
        Bollinger period
        <input type="number" v-model.number="bbPeriod" min="1" max="400" />
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
      :ma-period="maPeriod"
      :bb-period="bbPeriod"
      v-model:zoom="zoom"
    />
    <p class="hint">
      Drag the slider under the chart (or pinch) to adjust the graphed range.
      Source: Binance public market data (daily BTC/USDT closes since Aug 2017).
    </p>
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
</style>
