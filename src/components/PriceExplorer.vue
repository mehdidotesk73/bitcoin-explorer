<script setup lang="ts">
import { ref, computed } from 'vue'
import { type PricePoint, type FetchProgress } from '../api/bitcoin'
import { sma, bollinger } from '../lib/indicators'
import { mwHeat, type Horizon } from '../lib/mwheat'
import { logDebug } from '../debug'
import PriceChart from './PriceChart.vue'
import MetricsPanel from './MetricsPanel.vue'
import MwHeatDiagnostic from './MwHeatDiagnostic.vue'

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
  error: string
  progress: FetchProgress
  lastUpdated: number | null
}>()

const emit = defineEmits<{ refresh: [] }>()

// --- Adjustable parameters --------------------------------------------------
const maPeriod = ref(20)
const maUnit = ref<PeriodUnit>('day')
const bbPeriod = ref(20)
const bbUnit = ref<PeriodUnit>('day')
const bbK = ref(2)
const showHeat = ref(false) // tint the price line by the M/W heat score
const showHeatHelp = ref(false)
const showDiag = ref(false) // show the heat-components diagnostic chart
const showMetrics = ref(false) // show the metrics panel (price÷MA, b, runs)
const showRuns = ref(false) // overlay the piecewise-linear run skeleton on the price
const runHorizon = ref<Horizon>('weekly') // scale (window) driving runs/metrics
const showSignal = ref(false) // shade under price by the smoothed M/W signal
const signalPeriod = ref(21) // smoothing window (days) for the composite signal
const buyThreshold = ref(0.25) // buy-strength (= −composite) above this → green
const zoom = ref<[number, number]>([0, 100]) // graphed range, percent

// Live M/W heat tuning knobs (spec §11.5 fast-iteration loop).
const wDaily = ref(0.15)
const wWeekly = ref(0.55)
const wMonthly = ref(0.3)
const horizonGain = ref(4)
// Run-detector core knobs: sustainment threshold (≈ uptick fraction a run must
// clear). Doubles as the breakout-direction leniency in the matcher.
const sustThresh = ref(0.4)
// Run sensitivity, presented so higher = more/longer runs. The engine gate is
// the sustainment threshold a run must clear, so sensitivity = 0.9 − gate.
const runSensitivity = computed({
  get: () => +(0.9 - sustThresh.value).toFixed(2),
  set: (v) => (sustThresh.value = Math.max(0, Math.min(0.9, +(0.9 - v).toFixed(2)))),
})

const MW_HEAT_HELP =
  'M/W heat colours the price by how it oscillates around its moving average. ' +
  'It builds a smoothed price-vs-MA oscillator (taming sharp zigzags), then ' +
  'matches each window against the W / M shape: blue = W-bottom (two dips ' +
  'below the MA with a recovery between → bullish), red = M-top (two pushes ' +
  'above the MA, second weaker → bearish). Stronger, cleaner oscillations ' +
  'colour more boldly; flat or choppy stretches stay neutral. Heuristic only — ' +
  'not financial advice.'

// Data is daily, so week/month periods just scale the sample count.
type PeriodUnit = 'day' | 'week' | 'month'
const UNIT_DAYS: Record<PeriodUnit, number> = { day: 1, week: 7, month: 30 }
const UNIT_ABBR: Record<PeriodUnit, string> = { day: 'd', week: 'w', month: 'mo' }
const toDays = (period: number, unit: PeriodUnit) =>
  Math.max(1, Math.round(period * UNIT_DAYS[unit]))

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// --- Derived series (recomputed instantly on parameter change) --------------
const filtered = computed(() => props.raw)
const dates = computed(() => filtered.value.map((p) => toDateInput(p.time)))
const prices = computed(() => filtered.value.map((p) => p.price))

const maDays = computed(() => toDays(maPeriod.value, maUnit.value))
const bbDays = computed(() => toDays(bbPeriod.value, bbUnit.value))
const maLabel = computed(() => `${maPeriod.value}${UNIT_ABBR[maUnit.value]}`)
const bbLabel = computed(() => `${bbPeriod.value}${UNIT_ABBR[bbUnit.value]}`)

const ma = computed(() => sma(prices.value, maDays.value))
const bands = computed(() => bollinger(prices.value, bbDays.value, bbK.value))
// Multi-scale M/W price-heat: blends daily/weekly/monthly lenses via atanh
// pooling. +1 = M (hot/top), −1 = W (cool/bottom). The Bollinger period (in
// days) drives N — every horizon scales its own window from it.
const mwResult = computed(() =>
  mwHeat(prices.value, {
    N: Math.max(5, bbPeriod.value),
    weights: [wDaily.value, wWeekly.value, wMonthly.value],
    horizonGain: horizonGain.value,
    sustThresh: sustThresh.value,
  }),
)
// Piecewise-linear run skeleton: anchor the price at every run boundary and
// leave the rest null. The chart joins anchors with straight segments, so each
// run renders as a line at its average slope, continuous across choppy gaps.
const runOverlay = computed<(number | null)[]>(() => {
  const out = new Array(prices.value.length).fill(null)
  const diag = mwResult.value.horizons.find((h) => h.horizon === runHorizon.value)
  if (!diag) return out
  for (const r of diag.runs) {
    out[r.start] = prices.value[r.start]
    out[r.end] = prices.value[r.end]
  }
  return out
})

const heat = computed(() => {
  const res = mwResult.value
  const h = res.heat
  // Diagnostic: distribution + per-horizon + a spot-check at the latest day.
  let min = Infinity
  let max = -Infinity
  let nonZero = 0
  let absSum = 0
  for (const v of h) {
    if (v < min) min = v
    if (v > max) max = v
    if (Math.abs(v) > 0.02) nonZero++
    absSum += Math.abs(v)
  }
  logDebug(
    `heat: n=${h.length} min=${min.toFixed(2)} max=${max.toFixed(2)} ` +
      `mean|h|=${(absSum / (h.length || 1)).toFixed(2)} nonZero=${nonZero}`,
  )
  const t = h.length - 1
  if (t >= 0) {
    const per = res.horizons
      .map((hz) => `${hz.horizon[0]}=${(hz.heat[t] ?? 0).toFixed(2)}`)
      .join(' ')
    logDebug(`heat@last: composite=${h[t].toFixed(2)} [${per}]`)
    for (const hz of res.horizons) {
      logDebug(
        `  ${hz.horizon}: b=${(hz.b[t] ?? 0).toFixed(2)} ` +
          `tau=${hz.tau[t].toFixed(2)} vote=${hz.vote[t].toFixed(2)} H=${hz.heat[t].toFixed(2)}`,
      )
    }
    // Where do the strongest M (hot) and W (cool) signals land? Compare these
    // dates against the hand-annotated patterns.
    let iMax = 0
    let iMin = 0
    for (let i = 0; i < h.length; i++) {
      if (h[i] > h[iMax]) iMax = i
      if (h[i] < h[iMin]) iMin = i
    }
    logDebug(
      `heat extremes: strongest M ${h[iMax].toFixed(2)} @ ${dates.value[iMax]} · ` +
        `strongest W ${h[iMin].toFixed(2)} @ ${dates.value[iMin]}`,
    )
  }
  return h
})

// Smoothed composite M/W signal: a trailing moving average of the heat score,
// taming the sharp ±1 swings into a slow buy/sell trend. Sign follows the
// engine: negative = W (bottom, bullish/buy), positive = M (top, bearish/sell).
const signal = computed(() =>
  sma(heat.value, Math.max(1, signalPeriod.value)).map((v) => v ?? 0),
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

    <section class="controls">
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
      <label class="checkbox">
        <input type="checkbox" v-model="showHeat" />
        M/W heat
        <span
          class="help"
          :title="MW_HEAT_HELP"
          @click="showHeatHelp = !showHeatHelp"
        >ⓘ</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" v-model="showSignal" />
        Buy/hold signal
      </label>
      <label v-if="showSignal">
        Signal smoothing
        <span class="period">
          <input type="number" v-model.number="signalPeriod" min="1" max="200" />
          <span class="unit">days</span>
        </span>
      </label>
      <label v-if="showSignal">
        Buy threshold
        <input type="number" v-model.number="buyThreshold" min="0" max="1" step="0.05" />
      </label>
      <label class="checkbox">
        <input type="checkbox" v-model="showMetrics" />
        Metrics
      </label>
      <label class="checkbox">
        <input type="checkbox" v-model="showRuns" />
        Runs overlay
      </label>
      <label v-if="showRuns || showMetrics">
        Run scale
        <select v-model="runHorizon">
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
        </select>
      </label>
      <label v-if="showRuns || showMetrics">
        Run sensitivity
        <input type="number" v-model.number="runSensitivity" min="0" max="0.9" step="0.05" />
      </label>
      <label class="checkbox">
        <input type="checkbox" v-model="showDiag" />
        Components
      </label>
    </section>

    <p v-if="showHeatHelp" class="heat-help">{{ MW_HEAT_HELP }}</p>

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
      :heat="heat"
      :show-heat="showHeat"
      :signal="signal"
      :show-signal="showSignal"
      :buy-threshold="buyThreshold"
      :run-overlay="runOverlay"
      :show-runs="showRuns"
      v-model:zoom="zoom"
    />

    <MetricsPanel
      v-if="showMetrics && dates.length"
      :dates="dates"
      :price="prices"
      :ma="ma"
      :result="mwResult"
      :horizon="runHorizon"
      v-model:zoom="zoom"
    />

    <section v-if="showDiag" class="controls tune">
      <label>
        Daily weight
        <input type="number" v-model.number="wDaily" min="0" max="1" step="0.05" />
      </label>
      <label>
        Weekly weight
        <input type="number" v-model.number="wWeekly" min="0" max="1" step="0.05" />
      </label>
      <label>
        Monthly weight
        <input type="number" v-model.number="wMonthly" min="0" max="1" step="0.05" />
      </label>
      <label>
        Horizon gain
        <input type="number" v-model.number="horizonGain" min="0.5" max="12" step="0.5" />
      </label>
    </section>

    <MwHeatDiagnostic
      v-if="showDiag && dates.length"
      :dates="dates"
      :result="mwResult"
      :signal="signal"
      v-model:zoom="zoom"
    />

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
  align-self: flex-end;
}
.controls .checkbox input {
  width: auto;
}
.help {
  cursor: help;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 50%;
  width: 1.1rem;
  height: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
}
.heat-help {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.5;
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
