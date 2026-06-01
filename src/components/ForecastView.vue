<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import type { PricePoint } from '../api/bitcoin'
import ForecastChart from './ForecastChart.vue'
import {
  movingAverage,
  fitParams,
  projectForecast,
  DEFAULT_DAY_ZERO,
  DEFAULT_MA_WINDOW,
  DEFAULT_PEAK_DATES,
  DEFAULT_PEAK_SPREAD,
  type GrowthType,
  type EnvelopeType,
  type DistributionType,
  type SlopeVariant,
  type ForecastConfig,
} from '../lib/forecast'

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
}>()

// --- Base series ------------------------------------------------------------
const times = computed(() => props.raw.map((p) => p.time))
const prices = computed(() => props.raw.map((p) => p.price))

const maWindow = ref(DEFAULT_MA_WINDOW)
const dayZero = ref(DEFAULT_DAY_ZERO)
const dayZeroMs = computed(() => Date.parse(dayZero.value))
const ma = computed(() => movingAverage(prices.value, maWindow.value))

// Calibrate the value-growth fit to the last N days of data (0 = all history).
const fitWindowDays = ref(2920)
// Power-fit weighting: weight each point by (x+1)^(−γ). γ=0 is plain per-sample
// OLS; γ=1 weights equally per log-time decade, steepening β toward the early
// cycles. Tune to reproduce a preferred fit.
const powFitGamma = ref(1)

const peakDatesMs = computed(() => DEFAULT_PEAK_DATES.map((d) => Date.parse(d)))

// --- Automatic curve fit (recomputed when data / window / day-zero change) ---
const fitted = computed(() =>
  props.raw.length
    ? fitParams(
        times.value,
        prices.value,
        ma.value,
        dayZeroMs.value,
        peakDatesMs.value,
        fitWindowDays.value,
        powFitGamma.value,
      )
    : null,
)

// --- Model selections -------------------------------------------------------
const growthType = ref<GrowthType>('power')
const slopeVariant = ref<SlopeVariant>('median')
const envelopeType = ref<EnvelopeType>('exponential-decay')
const distributionType = ref<DistributionType>('peaks')
const peakSpread = ref(DEFAULT_PEAK_SPREAD)
const horizonYear = ref(2030)
const logY = ref(true)
const logX = ref(false)

// --- Editable parameters (seeded from the curve fit, user-overridable) ------
const p = reactive({
  expConstant: 12.456,
  expExponent: 0.001624,
  powConstant: 8e-14,
  powExponent: 4.7,
  linRate: 0,
  envConstant: 48.77,
  envExponent: 0.000511,
  vpdConstant: 1000,
  vpdPower: 0.6,
  vedConstant: 50,
  vedExponent: 0.245,
  vedPower: 0.245,
  constValue: 1,
})

/** Pull the latest auto-fit values into the editable params. */
function resetToFit() {
  const f = fitted.value
  if (!f) return
  p.expConstant = f.expConstant
  p.expExponent = f.expExponent
  p.powConstant = f.powConstant
  p.powExponent = f.powExponent
  p.envConstant = f.envConstant
  p.envExponent = f.envExponent
  p.linRate = f.slopeStats[slopeVariant.value]
}

// Seed parameters the first time a fit becomes available.
let seeded = false
watch(
  fitted,
  (f) => {
    if (f && !seeded) {
      resetToFit()
      seeded = true
    }
  },
  { immediate: true },
)

// Switching the linear slope variant adopts that variant's fitted slope.
watch(slopeVariant, () => {
  const f = fitted.value
  if (f) p.linRate = f.slopeStats[slopeVariant.value]
})

// Calibration inputs re-fit the growth curve so changes apply immediately.
// (The C/α/β boxes remain manual overrides until the next recalibration.)
watch([maWindow, dayZero, fitWindowDays, powFitGamma], () => {
  if (seeded) resetToFit()
})

// --- Forecast ---------------------------------------------------------------
const config = computed<ForecastConfig>(() => ({
  dayZeroMs: dayZeroMs.value,
  growthType: growthType.value,
  expConstant: p.expConstant,
  expExponent: p.expExponent,
  powConstant: p.powConstant,
  powExponent: p.powExponent,
  linRate: p.linRate,
  envelopeType: envelopeType.value,
  envConstant: p.envConstant,
  envExponent: p.envExponent,
  vpdConstant: p.vpdConstant,
  vpdPower: p.vpdPower,
  vedConstant: p.vedConstant,
  vedExponent: p.vedExponent,
  vedPower: p.vedPower,
  constValue: p.constValue,
  distributionType: distributionType.value,
  peakDatesMs: peakDatesMs.value,
  peakSpread: peakSpread.value,
  horizonMs: Date.parse(`${horizonYear.value}-12-31`),
  resolutionDays: 7,
}))

const forecast = computed(() =>
  props.raw.length
    ? projectForecast(config.value, {
        times: times.value,
        prices: prices.value,
        ma: ma.value,
      })
    : null,
)

const nowDate = new Date().toISOString().slice(0, 10)
const DAY_MS = 86_400_000

// Numeric x basis for the chart: days since the first plotted sample (≥ 1, so a
// log x-axis is always valid). A log-log view renders the power-law fit as a
// straight line.
const chartOrigin = computed(() => {
  const f = forecast.value
  return f && f.dates.length ? Date.parse(f.dates[0]) : 0
})
const xDays = computed(() => {
  const f = forecast.value
  if (!f) return []
  const t0 = chartOrigin.value
  return f.dates.map((d) => (Date.parse(d) - t0) / DAY_MS + 1)
})
const nowX = computed(() => (Date.parse(nowDate) - chartOrigin.value) / DAY_MS + 1)

// --- Chart tabs: each plots a model piece against its real-data counterpart --
type ChartTab = 'price' | 'baseline' | 'ratio' | 'envelope'
const chartTab = ref<ChartTab>('price')
const CHART_TABS: { id: ChartTab; label: string }[] = [
  { id: 'price', label: 'Price' },
  { id: 'baseline', label: 'Value baseline' },
  { id: 'ratio', label: 'Price ÷ MA' },
  { id: 'envelope', label: 'Envelope' },
]

const C_ORANGE = '#f7931a'
const C_BLUE = '#4f8ef7'
const C_VIOLET = '#9b6dff'
const C_TEAL = '#2bd4a7'

// Observed price ÷ trailing-MA ratio (the real counterpart to price/MA).
const actualRatio = computed(() => {
  const f = forecast.value
  if (!f) return []
  return f.actual.map((pr, i) => {
    const m = f.actualMa[i]
    return pr != null && m != null && m > 0 ? pr / m : null
  })
})

// Lowest real price on the grid — used to clamp the y-axis on dollar charts so
// the power-law baseline (which dives toward ~1e-13 near day zero) can't blow
// out the scale.
const priceFloor = computed(() => {
  const f = forecast.value
  if (!f) return null
  let min = Infinity
  for (const v of f.actual) if (v != null && v > 0 && v < min) min = v
  return Number.isFinite(min) ? min : null
})

const chartSeries = computed(() => {
  const f = forecast.value
  if (!f) return []
  switch (chartTab.value) {
    case 'baseline':
      return [
        { name: 'Actual 4yr MA', data: f.actualMa, color: C_ORANGE, width: 1.8 },
        { name: 'Model baseline (growth fit)', data: f.modelMa, color: C_BLUE },
      ]
    case 'ratio':
      return [
        { name: 'Actual price ÷ MA', data: actualRatio.value, color: C_ORANGE, width: 1.4 },
        { name: 'Model price ÷ MA', data: f.priceOverMa, color: C_VIOLET, dashed: true },
      ]
    case 'envelope':
      return [
        { name: 'Actual price ÷ MA', data: actualRatio.value, color: C_ORANGE, width: 1.2 },
        { name: 'Volatility envelope (max)', data: f.envelope, color: C_TEAL, width: 1.8 },
      ]
    default:
      return [
        { name: 'Value baseline (4yr MA)', data: f.modelMa, color: C_BLUE },
        { name: 'Projected price', data: f.projected, color: C_VIOLET, dashed: true },
        { name: 'Actual', data: f.actual, color: C_ORANGE, width: 1.8 },
      ]
  }
})

const chartFormat = computed<'usd' | 'ratio'>(() =>
  chartTab.value === 'ratio' || chartTab.value === 'envelope' ? 'ratio' : 'usd',
)
const chartYMin = computed(() => (chartFormat.value === 'usd' ? priceFloor.value : null))

// Headline: projected price at the horizon.
const horizonPrice = computed(() => {
  const f = forecast.value
  return f && f.projected.length ? f.projected[f.projected.length - 1] : null
})

// Human-readable hints for the calibration inputs.
const maYears = computed(() => (maWindow.value / 365).toFixed(1))
const fitWindowLabel = computed(() =>
  fitWindowDays.value > 0
    ? `last ${fitWindowDays.value} days (≈ ${(fitWindowDays.value / 365).toFixed(1)} yr)`
    : 'all history',
)

const fmtUSD = (v: number | null) =>
  v == null
    ? '—'
    : '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 2 : 0 })
const fmtNum = (v: number) =>
  Math.abs(v) > 1e-3 && Math.abs(v) < 1e6
    ? v.toLocaleString('en-US', { maximumFractionDigits: 6 })
    : v.toExponential(3)
</script>

<template>
  <div>
    <p class="headline" v-if="horizonPrice != null">
      Projected {{ horizonYear }} close:
      <strong>{{ fmtUSD(horizonPrice) }}</strong>
      <span class="muted"> · {{ growthType }} growth · {{ envelopeType }} envelope</span>
    </p>
    <section class="status" v-else-if="loading">Loading price history…</section>

    <p class="disclaimer">
      A structured what-if engine, not a predictor. Parameters load from an
      automatic log-space curve fit on the loaded history — adjust freely, or
      reset to the fit.
    </p>

    <!-- Model selection -->
    <section class="controls">
      <label>
        Value growth
        <select v-model="growthType">
          <option value="power">Power-law</option>
          <option value="exponential">Exponential</option>
          <option value="linear">Linear</option>
        </select>
      </label>
      <label v-if="growthType === 'linear'">
        Slope variant
        <select v-model="slopeVariant">
          <option value="min">min</option>
          <option value="median">median</option>
          <option value="mean">mean</option>
          <option value="max">max</option>
        </select>
      </label>
      <label>
        Envelope
        <select v-model="envelopeType">
          <option value="exponential-decay">Time exp-decay</option>
          <option value="value-power-decay">Value power-decay</option>
          <option value="value-exponential-decay">Value exp-decay</option>
          <option value="constant">Constant</option>
        </select>
      </label>
      <label>
        Peaks
        <select v-model="distributionType">
          <option value="peaks">Cycle peaks</option>
          <option value="none">None</option>
        </select>
      </label>
      <label>
        Horizon
        <select v-model.number="horizonYear">
          <option :value="2030">2030</option>
          <option :value="2035">2035</option>
          <option :value="2040">2040</option>
          <option :value="2050">2050</option>
        </select>
      </label>
      <label class="checkbox">
        <input type="checkbox" v-model="logX" />
        Log X
      </label>
      <label class="checkbox">
        <input type="checkbox" v-model="logY" />
        Log Y
      </label>
      <button class="reset" @click="resetToFit">↺ Reset to fit</button>
    </section>

    <!-- Parameters: value baseline + growth -->
    <section class="params">
      <h3>Value baseline</h3>
      <div class="param-grid">
        <label>
          MA window (days)
          <input type="number" v-model.number="maWindow" min="30" max="3000" step="5" />
        </label>
        <label>
          Fit window (days, 0 = all)
          <input type="number" v-model.number="fitWindowDays" min="0" max="6000" step="50" />
        </label>
        <label>
          Day zero
          <input type="date" v-model="dayZero" />
        </label>
        <span class="fit-note">
          MA ≈ {{ maYears }} yr · growth fit on {{ fitWindowLabel }}
        </span>
      </div>

      <template v-if="growthType === 'exponential'">
        <h3>
          Exponential growth
          <span class="fit" v-if="fitted">R² {{ fitted.expR2.toFixed(4) }}</span>
        </h3>
        <div class="param-grid">
          <label>
            Constant C
            <input type="number" v-model.number="p.expConstant" step="any" />
          </label>
          <label>
            Exponent α
            <input type="number" v-model.number="p.expExponent" step="any" />
          </label>
        </div>
        <p class="eq">MA = C · e^(α · x)</p>
      </template>

      <template v-else-if="growthType === 'power'">
        <h3>
          Power-law growth
          <span class="fit" v-if="fitted">R² {{ fitted.powR2.toFixed(4) }}</span>
        </h3>
        <div class="param-grid">
          <label>
            Constant C
            <input type="number" v-model.number="p.powConstant" step="any" />
          </label>
          <label>
            Power β
            <input type="number" v-model.number="p.powExponent" step="any" />
          </label>
          <label>
            Fit weighting γ
            <input
              type="number"
              v-model.number="powFitGamma"
              min="0"
              max="2"
              step="0.05"
            />
          </label>
          <span class="fit-note">γ=0 per-sample · γ=1 per log-time decade</span>
        </div>
        <p class="eq">MA = C · (x + 1)^β · &nbsp; fit weight ∝ (x + 1)^(−γ)</p>
      </template>

      <template v-else>
        <h3>Linear growth</h3>
        <div class="param-grid">
          <label>
            Rate (per day)
            <input type="number" v-model.number="p.linRate" step="any" />
          </label>
          <span class="fit-note" v-if="fitted">
            fitted {{ slopeVariant }} slope:
            {{ fmtNum(fitted.slopeStats[slopeVariant]) }} /day
          </span>
        </div>
        <p class="eq">MA = last_MA + rate · Δt</p>
      </template>
    </section>

    <!-- Parameters: volatility -->
    <section class="params">
      <h3>Volatility envelope</h3>
      <template v-if="envelopeType === 'exponential-decay'">
        <div class="param-grid">
          <label>
            Constant C
            <input type="number" v-model.number="p.envConstant" step="any" />
          </label>
          <label>
            Decay λ
            <input type="number" v-model.number="p.envExponent" step="any" />
          </label>
        </div>
        <p class="eq">envelope = 1 + C · e^(−λ · x)</p>
      </template>
      <template v-else-if="envelopeType === 'value-power-decay'">
        <div class="param-grid">
          <label>
            Constant C
            <input type="number" v-model.number="p.vpdConstant" step="any" />
          </label>
          <label>
            Power p
            <input type="number" v-model.number="p.vpdPower" step="any" />
          </label>
        </div>
        <p class="eq">envelope = 1 + C / MA^p</p>
      </template>
      <template v-else-if="envelopeType === 'value-exponential-decay'">
        <div class="param-grid">
          <label>
            Constant C
            <input type="number" v-model.number="p.vedConstant" step="any" />
          </label>
          <label>
            Exponent λ
            <input type="number" v-model.number="p.vedExponent" step="any" />
          </label>
          <label>
            Power p
            <input type="number" v-model.number="p.vedPower" step="any" />
          </label>
        </div>
        <p class="eq">envelope = 1 + C · e^(−λ · MA^p)</p>
      </template>
      <template v-else>
        <div class="param-grid">
          <label>
            Value
            <input type="number" v-model.number="p.constValue" step="any" />
          </label>
        </div>
        <p class="eq">envelope = value</p>
      </template>

      <template v-if="distributionType === 'peaks'">
        <h3>Cycle peaks</h3>
        <div class="param-grid">
          <label>
            Spread
            <input type="number" v-model.number="peakSpread" step="any" min="0.0001" />
          </label>
          <span class="fit-note">
            {{ DEFAULT_PEAK_DATES.length }} tops: {{ DEFAULT_PEAK_DATES.join(', ') }}
          </span>
        </div>
        <p class="eq">p/MA = 1 + (envelope − 1) · Σ e^(−spread · |x − dᵢ|)</p>
      </template>
    </section>

    <div class="chart-tabs" v-if="forecast">
      <button
        v-for="t in CHART_TABS"
        :key="t.id"
        :class="{ active: chartTab === t.id }"
        @click="chartTab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <ForecastChart
      v-if="forecast"
      :dates="forecast.dates"
      :series="chartSeries"
      :x="xDays"
      :origin-ms="chartOrigin"
      :now-x="nowX"
      :log-x="logX"
      :log-y="logY"
      :y-min="chartYMin"
      :value-format="chartFormat"
    />
  </div>
</template>

<style scoped>
.headline {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}
.headline strong {
  color: var(--accent-violet);
}
.muted {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.85rem;
}
.disclaimer {
  color: var(--text-muted);
  font-size: 0.78rem;
  margin: 0 0 0.9rem;
}
.status {
  padding: 0.6rem 0.8rem;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: flex-end;
  margin-bottom: 0.75rem;
}
.controls label {
  display: flex;
  flex-direction: column;
  font-size: 0.72rem;
  color: var(--text-muted);
  gap: 0.2rem;
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
.reset {
  border-color: var(--accent-violet);
  color: var(--accent-violet);
}
.reset:hover {
  background: var(--accent-violet);
  border-color: var(--accent-violet);
  color: #fff;
}
.params {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.8rem;
}
.params h3 {
  margin: 0.2rem 0 0.5rem;
  font-size: 0.82rem;
  color: var(--accent-blue);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.params h3 .fit {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.72rem;
}
.param-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: flex-end;
}
.param-grid label {
  display: flex;
  flex-direction: column;
  font-size: 0.72rem;
  color: var(--text-muted);
  gap: 0.2rem;
}
.param-grid input {
  width: 9rem;
}
.fit-note {
  font-size: 0.72rem;
  color: var(--text-muted);
  align-self: center;
}
.eq {
  font-family: ui-monospace, monospace;
  font-size: 0.74rem;
  color: var(--text-muted);
  margin: 0.5rem 0 0;
}
.chart-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}
.chart-tabs button {
  font-size: 0.78rem;
  padding: 0.3rem 0.7rem;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  cursor: pointer;
}
.chart-tabs button.active {
  border-color: var(--accent-blue);
  color: var(--accent-blue);
  background: rgba(79, 142, 247, 0.12);
}

</style>
