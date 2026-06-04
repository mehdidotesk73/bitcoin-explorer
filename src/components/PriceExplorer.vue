<script setup lang="ts">
import { ref, computed } from 'vue'
import { type PricePoint, type FetchProgress } from '../api/bitcoin'
import { sma, bollinger } from '../lib/indicators'
import { type PeriodUnit, UNIT_ABBR, toDays } from '../lib/period'
import { fmtUSD } from '../lib/format'
import { usePriceSeries } from '../lib/usePriceSeries'
import { useBandScore } from '../lib/useBandScore'
import { scaleDiag } from '../lib/runs'
import PriceChart from './PriceChart.vue'
import MetricsPanel from './MetricsPanel.vue'
import InfoTip from './InfoTip.vue'

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
  error: string
  progress: FetchProgress
  lastUpdated: number | null
}>()

const emit = defineEmits<{ refresh: [] }>()

// --- Metric toggles (default view = price only) -----------------------------
const showMa = ref(false) // MA overlay
const showBb = ref(false) // Bollinger overlay
const showRunDetection = ref(false) // runs overlay (price) + run-slope graph
const showRatio = ref(false) // price ÷ MA curve
const showBand = ref(false) // band position (smoothed-%B / Bollinger-score family)

// Per-metric config disclosure state.
const cfgMa = ref(false)
const cfgBb = ref(false)
const cfgRatio = ref(false)
const cfgRun = ref(false)
const cfgBand = ref(false)

// Whether any separate-curve metric is on, and whether that panel is collapsed.
const anyCurve = computed(
  () => showRatio.value || showBand.value || showRunDetection.value,
)
const curvesCollapsed = ref(false)

// The metric-toggle menu folds into a single disclosure so it can get out of the
// way once metrics are chosen (mobile screen space). When collapsed, summarise
// which metrics are active.
const menuCollapsed = ref(false)
const activeMetricLabels = computed(() => {
  const out: string[] = []
  if (showMa.value) out.push('MA')
  if (showBb.value) out.push('Bollinger')
  if (showRunDetection.value) out.push('Runs')
  if (showRatio.value) out.push('Price ÷ MA')
  if (showBand.value) out.push('Bollinger score')
  return out
})

// --- Metric parameters ------------------------------------------------------
// MA overlay.
const maPeriod = ref(20)
const maUnit = ref<PeriodUnit>('day')
// Bollinger overlay.
const bbPeriod = ref(20)
const bbUnit = ref<PeriodUnit>('day')
const bbK = ref(2)
// Price ÷ MA: its own long baseline (independent of the Hodl Explorer).
const ratioMaDays = ref(1460)

// Shared run params. Scale is a continuous (log) window in days: the slider
// position 0–100 maps to hd ∈ [1, 1500] and the label snaps to the nearest
// named scale below.
const RUN_SCALES = [
  { name: 'daily', hd: 1 },
  { name: 'weekly', hd: 5 },
  { name: 'monthly', hd: 20 },
  { name: 'seasonal', hd: 65 },
  { name: 'yearly', hd: 250 },
  { name: 'multi-year', hd: 1000 },
]
const RUN_SCALE_MAX = 1500
const tForHd = (hd: number) => Math.round((100 * Math.log(hd)) / Math.log(RUN_SCALE_MAX))
const runScaleT = ref(tForHd(31)) // default scale ≈ 31d
const runScaleDays = computed(() =>
  Math.max(1, Math.round(Math.exp((Math.log(RUN_SCALE_MAX) * runScaleT.value) / 100))),
)
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
// Sustainment gate a run must clear. Presented as sensitivity (higher = more /
// longer runs), so sensitivity = 0.9 − gate. Default sensitivity 0.2 → gate 0.7.
const sustThresh = ref(0.7)
const runSensitivity = computed({
  get: () => +(0.9 - sustThresh.value).toFixed(2),
  set: (v) => (sustThresh.value = Math.max(0, Math.min(0.9, +(0.9 - v).toFixed(2)))),
})

const zoom = ref<[number, number]>([0, 100]) // graphed range, percent

// --- Derived series (recomputed instantly on parameter change) --------------
const { prices, dates } = usePriceSeries(() => props.raw)

const maDays = computed(() => toDays(maPeriod.value, maUnit.value))
const bbDays = computed(() => toDays(bbPeriod.value, bbUnit.value))
const maLabel = computed(() => `${maPeriod.value}${UNIT_ABBR[maUnit.value]}`)
const bbLabel = computed(() => `${bbPeriod.value}${UNIT_ABBR[bbUnit.value]}`)

const ma = computed(() => sma(prices.value, maDays.value))
const ratioMa = computed(() => sma(prices.value, ratioMaDays.value))
const ratioMaLabel = computed(() => `${(ratioMaDays.value / 365).toFixed(1)}yr`)
const bands = computed(() => bollinger(prices.value, bbDays.value, bbK.value))

// Band position ("Bollinger score") — own Period/unit/σ/smoothing + series.
const {
  smooth: bandSmooth,
  period: bandPeriod,
  unit: bandUnit,
  k: bandK,
  label: bandLabel,
  smoothLabel: bandSmoothLabel,
  series: bandSeries,
} = useBandScore(prices)

// Runs/metrics at the selected continuous scale.
const runDiag = computed(() =>
  scaleDiag(prices.value, runScaleDays.value, {
    N: Math.max(5, bbPeriod.value),
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
  const n = prices.value.length
  if (!n || days === 'all') {
    zoom.value = [0, 100]
    return
  }
  const start = Math.max(0, ((n - days) / n) * 100)
  zoom.value = [start, 100]
}

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

    <section class="metrics-section">
      <button class="menu-toggle" @click="menuCollapsed = !menuCollapsed">
        <span class="chev">{{ menuCollapsed ? '▸' : '▾' }}</span> Metrics
        <span class="menu-summary" v-if="menuCollapsed">
          {{ activeMetricLabels.length ? activeMetricLabels.join(' · ') : 'none selected' }}
        </span>
      </button>
      <div v-show="!menuCollapsed" class="controls metrics-menu">
      <!-- Overlay: moving average -->
      <div class="metric">
        <div class="metric-head">
          <label class="checkbox"><input type="checkbox" v-model="showMa" /> Moving average</label>
          <InfoTip term="ma" />
          <button class="cfg" :class="{ open: cfgMa }" @click="cfgMa = !cfgMa" title="Configure">⚙</button>
        </div>
        <div v-if="cfgMa" class="metric-cfg">
          <label>
            Period
            <span class="period">
              <input type="number" v-model.number="maPeriod" min="1" max="400" />
              <select v-model="maUnit">
                <option value="day">days</option>
                <option value="week">weeks</option>
                <option value="month">months</option>
              </select>
            </span>
          </label>
        </div>
      </div>

      <!-- Overlay: Bollinger bands -->
      <div class="metric">
        <div class="metric-head">
          <label class="checkbox"><input type="checkbox" v-model="showBb" /> Bollinger bands</label>
          <InfoTip term="bollinger" />
          <button class="cfg" :class="{ open: cfgBb }" @click="cfgBb = !cfgBb" title="Configure">⚙</button>
        </div>
        <div v-if="cfgBb" class="metric-cfg">
          <label>
            Period
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
            σ × <InfoTip term="sigma" />
            <input type="number" v-model.number="bbK" min="0.5" max="5" step="0.5" />
          </label>
        </div>
      </div>

      <!-- Run detection: runs overlay (price) + run-slope graph -->
      <div class="metric">
        <div class="metric-head">
          <label class="checkbox"><input type="checkbox" v-model="showRunDetection" /> Run detection</label>
          <InfoTip term="run" />
          <button class="cfg" :class="{ open: cfgRun }" @click="cfgRun = !cfgRun" title="Configure">⚙</button>
        </div>
        <div v-if="cfgRun" class="metric-cfg">
          <label class="slider">
            Scale <InfoTip term="scale" />
            <input type="range" v-model.number="runScaleT" min="0" max="100" step="1" />
            <span class="val">{{ runScaleLabel }}</span>
          </label>
          <label class="slider">
            Sensitivity <InfoTip term="sensitivity" />
            <input type="range" v-model.number="runSensitivity" min="0" max="0.9" step="0.05" />
            <span class="val">{{ runSensitivity.toFixed(2) }}</span>
          </label>
        </div>
      </div>

      <!-- Curve: price ÷ MA -->
      <div class="metric">
        <div class="metric-head">
          <label class="checkbox"><input type="checkbox" v-model="showRatio" /> Price ÷ MA</label>
          <InfoTip term="ratio" />
          <button class="cfg" :class="{ open: cfgRatio }" @click="cfgRatio = !cfgRatio" title="Configure">⚙</button>
        </div>
        <div v-if="cfgRatio" class="metric-cfg">
          <label>
            MA window
            <span class="period">
              <input type="number" v-model.number="ratioMaDays" min="30" max="2000" step="10" />
              <span class="unit">days</span>
            </span>
          </label>
        </div>
      </div>

      <!-- Curve: band position (smoothed-%B / Bollinger-score family) -->
      <div class="metric">
        <div class="metric-head">
          <label class="checkbox"><input type="checkbox" v-model="showBand" /> Bollinger score</label>
          <InfoTip term="bollingerScore" />
          <button class="cfg" :class="{ open: cfgBand }" @click="cfgBand = !cfgBand" title="Configure">⚙</button>
        </div>
        <div v-if="cfgBand" class="metric-cfg">
          <p class="cfg-note">
            (EMA·price − MA) ÷ k·σ over one window. 0 = MA, ±1 = ±kσ bands.
            Smoothing 0 + short window = classic %B.
          </p>
          <label>
            Period <InfoTip term="period" />
            <span class="period">
              <input type="number" v-model.number="bandPeriod" min="2" max="3000" />
              <select v-model="bandUnit">
                <option value="day">days</option>
                <option value="week">weeks</option>
                <option value="month">months</option>
              </select>
            </span>
          </label>
          <label>
            σ × <InfoTip term="sigma" />
            <input type="number" v-model.number="bandK" min="0.5" max="5" step="0.5" />
          </label>
          <label>
            Smoothing <InfoTip term="smoothing" />
            <span class="period">
              <input type="number" v-model.number="bandSmooth" min="0" max="365" step="1" />
              <span class="unit">{{ bandSmoothLabel }}</span>
            </span>
          </label>
        </div>
      </div>
      </div>
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
      :show-ma="showMa"
      :show-bb="showBb"
      :run-overlay="runOverlay"
      :show-runs="showRunDetection"
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
        :show-ratio="showRatio"
        :show-band="showBand"
        :band="bandSeries"
        :band-label="bandLabel"
        :show-run-slope="showRunDetection"
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
.metrics-section {
  margin-bottom: 0.75rem;
}
.metrics-menu {
  align-items: flex-start;
}
.metrics-section .metrics-menu {
  margin-top: 0.4rem;
  margin-bottom: 0;
}
.menu-toggle {
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
.menu-summary {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-style: italic;
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
