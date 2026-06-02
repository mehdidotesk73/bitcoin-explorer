<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { type PricePoint, type FetchProgress } from '../api/bitcoin'
import { sma, bollinger } from '../lib/indicators'
import { scaleDiag } from '../lib/runs'
import {
  METRIC_SPECS,
  type MetricState,
  type PeriodUnit,
  defaultMetricState,
  loadMetricState,
  saveMetricState,
  decodeMetricState,
  encodeMetricState,
} from '../lib/metricRegistry'
import PriceChart from './PriceChart.vue'
import MetricsPanel from './MetricsPanel.vue'

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
  error: string
  progress: FetchProgress
  lastUpdated: number | null
}>()

const emit = defineEmits<{ refresh: [] }>()

// --- Metric state (persisted to localStorage) --------------------------------
const metricState = ref<MetricState>(defaultMetricState())
const cfgOpen = ref<Record<string, boolean>>({}) // which metric config is expanded

// Load initial state on mount: URL query params > localStorage > defaults.
onMounted(() => {
  let state = defaultMetricState()

  // Try to load from URL query params (for shareability).
  const query = window.location.search.slice(1)
  if (query) {
    const urlState = decodeMetricState(query)
    if (urlState.enabled || urlState.params || urlState.periodUnits) {
      state = {
        enabled: { ...state.enabled, ...urlState.enabled },
        params: { ...state.params, ...urlState.params },
        periodUnits: { ...state.periodUnits, ...urlState.periodUnits },
      }
    }
  } else {
    // No URL params; try localStorage.
    state = loadMetricState()
  }

  metricState.value = state
})

// Persist state changes to localStorage.
watch(() => metricState.value, saveMetricState, { deep: true })

// Whether any separate-curve metric is on, and whether that panel is collapsed.
const anyCurve = computed(() => {
  return (
    metricState.value.enabled['ratio'] ||
    metricState.value.enabled['bscore'] ||
    metricState.value.enabled['runSlope']
  )
})
const curvesCollapsed = ref(false)

// --- Unit conversion helpers --------------------------------------------------
const UNIT_DAYS: Record<PeriodUnit, number> = { day: 1, week: 7, month: 30 }
const UNIT_ABBR: Record<PeriodUnit, string> = { day: 'd', week: 'w', month: 'mo' }
const toDays = (period: number, unit: PeriodUnit) =>
  Math.max(1, Math.round(period * UNIT_DAYS[unit]))

// --- Run scale helpers (log slider mapping + named scale snapping) ----------
const RUN_SCALES = [
  { name: 'daily', hd: 1 },
  { name: 'weekly', hd: 5 },
  { name: 'monthly', hd: 20 },
  { name: 'seasonal', hd: 65 },
  { name: 'yearly', hd: 250 },
  { name: 'multi-year', hd: 1000 },
]
const RUN_SCALE_MAX = 1500
const runScaleDays = computed(() => {
  const scaleT = metricState.value.params['runs']?.['scaleT'] ?? 34
  return Math.max(1, Math.round(Math.exp((Math.log(RUN_SCALE_MAX) * (scaleT as number)) / 100)))
})
const runScaleLabel = computed(() => {
  const hd = runScaleDays.value
  let best = RUN_SCALES[0]
  let bestD = Infinity
  for (const s of RUN_SCALES) {
    const dist = Math.abs(Math.log(hd) - Math.log(s.hd))
    if (dist < bestD) {
      bestD = dist
      best = s
    }
  }
  return `${best.name} · ${hd}d`
})

// Sensitivity → sustThresh conversion (sensitivity = 0.9 − sustThresh).
const sustThresh = computed(() => {
  const sensitivity = metricState.value.params['runs']?.['sensitivity'] ?? 0.2
  return Math.max(0, Math.min(0.9, +(0.9 - (sensitivity as number)).toFixed(2)))
})

const zoom = ref<[number, number]>([0, 100]) // graphed range, percent

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// --- Derived series (recomputed instantly on parameter change) --------------
const filtered = computed(() => props.raw)
const dates = computed(() => filtered.value.map((p) => toDateInput(p.time)))
const prices = computed(() => filtered.value.map((p) => p.price))

// MA overlay: compute from period + unit in metricState.
const maPeriod = computed(() => metricState.value.params['ma']?.['period'] ?? 20)
const maUnit = computed(() => metricState.value.periodUnits['ma.period'] ?? 'day')
const maDays = computed(() => toDays(maPeriod.value as number, maUnit.value))
const maLabel = computed(() => `${maPeriod.value}${UNIT_ABBR[maUnit.value]}`)
const ma = computed(() => sma(prices.value, maDays.value))

// Bollinger overlay: compute from period + unit + k in metricState.
const bbPeriod = computed(() => metricState.value.params['bb']?.['period'] ?? 20)
const bbUnit = computed(() => metricState.value.periodUnits['bb.period'] ?? 'day')
const bbDays = computed(() => toDays(bbPeriod.value as number, bbUnit.value))
const bbLabel = computed(() => `${bbPeriod.value}${UNIT_ABBR[bbUnit.value]}`)
const bbK = computed(() => metricState.value.params['bb']?.['k'] ?? 2)
const bands = computed(() => bollinger(prices.value, bbDays.value, bbK.value as number))

// Price ÷ MA curve: long baseline so ratio traces regimes instead of hugging 1.
const ratioMaDays = computed(() => metricState.value.params['ratio']?.['maDays'] ?? 1460)
const ratioMaLabel = computed(() => `${((ratioMaDays.value as number) / 365).toFixed(1)}yr`)
const ratioMa = computed(() => sma(prices.value, ratioMaDays.value as number))

// Runs/metrics at the selected continuous scale.
const runDiag = computed(() =>
  scaleDiag(prices.value, runScaleDays.value, {
    N: Math.max(5, bbDays.value),
    sustThresh: sustThresh.value,
  }),
)

// Piecewise-linear run skeleton: anchor the price at every run boundary and
// leave the rest null. The chart joins anchors with straight segments, so each
// run renders as a line at its average slope, continuous across choppy gaps.
const runOverlay = computed<(number | null)[]>(() => {
  const out = new Array(prices.value.length).fill(null)
  for (const r of runDiag.value.runs) {
    out[r.start] = prices.value[r.start]
    out[r.end] = prices.value[r.end]
  }
  return out
})

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

// Generate a shareable URL with current metrics state encoded in query params.
async function copyShareUrl() {
  const query = encodeMetricState(metricState.value)
  const url = `${window.location.origin}${window.location.pathname}${query ? '?' + query : ''}`
  try {
    await navigator.clipboard.writeText(url)
    // Visual feedback: the emoji button could briefly change. For now, silent success.
  } catch {
    // Fallback: alert the user.
    alert(`Shareable URL:\n\n${url}`)
  }
}

const fmtUSD = (v: number | null) =>
  v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
</script>

<template>
  <div>
    <p class="latest" v-if="latestPrice">
      Latest close: <strong>{{ fmtUSD(latestPrice) }}</strong>
      <span class="muted" v-if="lastUpdated">
        · updated {{ new Date(lastUpdated).toLocaleString() }}
      </span>
    </p>

    <section class="status" v-if="loading">
      Loading daily prices… {{ progress.bars }} bars over {{ progress.pages }} page(s)
    </section>
    <section class="status error" v-else-if="error">
      ⚠️ {{ error }}
      <button @click="emit('refresh')">Retry</button>
    </section>

    <section class="controls metrics-menu">
      <!-- Data-driven metric rendering: each metric has its spec, toggle, and collapsible config. -->
      <template v-for="spec of Object.values(METRIC_SPECS)" :key="spec.id">
        <div v-if="spec" class="metric">
          <div class="metric-head">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="metricState.enabled[spec.id]"
                @change="(e: Event) => (metricState.enabled[spec.id] = (e.target as HTMLInputElement).checked)"
              />
              {{ spec.label }}
            </label>
            <button
              v-if="spec.params.length > 0 || spec.sharedParamGroup"
              class="cfg"
              :class="{ open: cfgOpen[spec.id] }"
              @click="cfgOpen[spec.id] = !cfgOpen[spec.id]"
              title="Configure"
            >
              ⚙
            </button>
          </div>

          <!-- Config panel for this metric's params or shared-param note. -->
          <div v-if="cfgOpen[spec.id]" class="metric-cfg">
            <!-- If this metric shares params with another, show a note. -->
            <p v-if="spec.sharedParamGroup" class="cfg-note">
              Shares {{ METRIC_SPECS[spec.sharedParamGroup].label.toLowerCase() }} scale &amp; sensitivity.
            </p>

            <!-- Render each param for this metric. -->
            <template v-for="param of spec.params" :key="param.id">
              <!-- Period param with unit dropdown. -->
              <label v-if="param.hasPeriodUnit" class="period-control">
                {{ param.label }}
                <span class="period">
                  <input
                    type="number"
                    :value="metricState.params[spec.id]?.[param.id] ?? param.default"
                    @input="(e: Event) => {
                      const val = Number((e.target as HTMLInputElement).value);
                      if (!metricState.params[spec.id]) metricState.params[spec.id] = {};
                      metricState.params[spec.id][param.id] = val;
                    }"
                    :min="param.min"
                    :max="param.max"
                  />
                  <select
                    :value="metricState.periodUnits[`${spec.id}.${param.id}`] ?? 'day'"
                    @change="(e: Event) => {
                      metricState.periodUnits[`${spec.id}.${param.id}`] = (e.target as HTMLSelectElement).value as PeriodUnit;
                    }"
                  >
                    <option value="day">days</option>
                    <option value="week">weeks</option>
                    <option value="month">months</option>
                  </select>
                </span>
              </label>

              <!-- Slider param. -->
              <label v-else-if="param.type === 'number' && (param.min !== undefined || param.max !== undefined)" class="slider">
                {{ param.label }}
                <input
                  type="range"
                  :value="metricState.params[spec.id]?.[param.id] ?? param.default"
                  @input="(e: Event) => {
                    const val = Number((e.target as HTMLInputElement).value);
                    if (!metricState.params[spec.id]) metricState.params[spec.id] = {};
                    metricState.params[spec.id][param.id] = val;
                  }"
                  :min="param.min"
                  :max="param.max"
                  :step="param.step ?? 0.1"
                />
                <span class="val">{{
                  spec.id === 'runs' && param.id === 'scaleT'
                    ? runScaleLabel
                    : spec.id === 'runs' && param.id === 'sensitivity'
                      ? ((metricState.params[spec.id]?.[param.id] ?? param.default) as number).toFixed(2)
                      : (metricState.params[spec.id]?.[param.id] ?? param.default)
                }}</span>
              </label>

              <!-- Regular number input param. -->
              <label v-else class="number-control">
                {{ param.label }}
                <span v-if="spec.id === 'ratio'" class="period">
                  <input
                    type="number"
                    :value="metricState.params[spec.id]?.[param.id] ?? param.default"
                    @input="(e: Event) => {
                      const val = Number((e.target as HTMLInputElement).value);
                      if (!metricState.params[spec.id]) metricState.params[spec.id] = {};
                      metricState.params[spec.id][param.id] = val;
                    }"
                    :min="param.min"
                    :max="param.max"
                    :step="param.step"
                  />
                  <span class="unit">days</span>
                </span>
                <input
                  v-else
                  type="number"
                  :value="metricState.params[spec.id]?.[param.id] ?? param.default"
                  @input="(e: Event) => {
                    const val = Number((e.target as HTMLInputElement).value);
                    if (!metricState.params[spec.id]) metricState.params[spec.id] = {};
                    metricState.params[spec.id][param.id] = val;
                  }"
                  :min="param.min"
                  :max="param.max"
                  :step="param.step"
                />
              </label>
            </template>
          </div>
        </div>
      </template>
    </section>

    <section class="ranges">
      <span class="muted">Graphed range:</span>
      <button @click="setRange(30)">1M</button>
      <button @click="setRange(90)">3M</button>
      <button @click="setRange(365)">1Y</button>
      <button @click="setRange(365 * 3)">3Y</button>
      <button @click="setRange('all')">All</button>
      <button class="share-btn" @click="copyShareUrl" title="Copy shareable URL with current metrics">📋</button>
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
      :show-ma="metricState.enabled['ma']"
      :show-bb="metricState.enabled['bb']"
      :run-overlay="runOverlay"
      :show-runs="metricState.enabled['runs']"
      v-model:zoom="zoom"
    />

    <section v-if="anyCurve && dates.length" class="curves">
      <button class="curves-toggle" @click="curvesCollapsed = !curvesCollapsed">
        <span class="chev">{{ curvesCollapsed ? '▸' : '▾' }}</span> Additional graphs
      </button>
      <MetricsPanel
        v-if="!curvesCollapsed"
        :dates="dates"
        :price="prices"
        :ma="ratioMa"
        :ma-label="ratioMaLabel"
        :diag="runDiag"
        :scale-label="runScaleLabel"
        :show-ratio="metricState.enabled['ratio']"
        :show-b="metricState.enabled['bscore']"
        :show-run-slope="metricState.enabled['runSlope']"
        v-model:zoom="zoom"
      />
    </section>

    <p class="hint">
      Drag the slider under the chart (or pinch) to adjust the graphed range.
      Sources: CoinMarketCap (daily closes before Aug 2017) + Binance public
      market data (daily BTC/USDT closes from Aug 2017).
    </p>
  </div>
</template>

<style scoped>
.latest {
  margin: 0 0 0.75rem;
}
.muted {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.85rem;
}
.status {
  padding: 0.6rem 0.8rem;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}
.status.error {
  background: var(--danger-bg);
  border-color: var(--danger);
}
.controls,
.ranges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.75rem;
}
.share-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.2rem 0.4rem;
  color: var(--text-muted);
}
.metrics-menu {
  align-items: flex-start;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.4rem 0.55rem;
  background: var(--bg-elev);
}
.metric-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.cfg-note {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.curves {
  margin-bottom: 0.5rem;
}
.curves-toggle {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 0.2rem 0;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.chev {
  font-size: 0.7rem;
}
.cfg {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1;
  padding: 0 0.15rem;
}
.cfg.open {
  color: var(--accent-blue);
}
.metric-cfg {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--border);
}
.controls label {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: var(--text-muted);
  gap: 0.2rem;
}
.controls input {
  width: 8rem;
}
.controls .checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
  color: var(--text);
  font-size: 0.8rem;
}
.controls .checkbox input {
  width: auto;
}
.controls .slider {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}
.controls .slider input[type='range'] {
  width: 7rem;
}
.controls .slider .val {
  font-variant-numeric: tabular-nums;
  color: var(--text);
  min-width: 2.2rem;
}
.period {
  display: flex;
  gap: 0.3rem;
}
.period input {
  width: 4rem;
}
.hint {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 0.75rem;
}
</style>
