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
  DEFAULT_SLOPE_RANGE_DAYS,
  DEFAULT_SLOPE_WINDOW_DAYS,
  DEFAULT_SLOPE_PERCENTILE,
  type GrowthType,
  type EnvelopeType,
  type DistributionType,
  type ForecastConfig,
} from '../lib/forecast'
import { fmtUSD } from '../lib/format'
import { usePriceSeries } from '../lib/usePriceSeries'
import InfoTip from './InfoTip.vue'

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
}>()

// --- Base series ------------------------------------------------------------
const times = computed(() => props.raw.map((p) => p.time))
const { prices } = usePriceSeries(() => props.raw)

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

const peakDates = ref<string[]>([...DEFAULT_PEAK_DATES])
const peakDatesMs = computed(() => peakDates.value.map((d) => Date.parse(d)))

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
        slopeRangeDays.value,
        slopeWindowDays.value,
        slopePercentile.value,
      )
    : null,
)

// --- Model selections -------------------------------------------------------
const growthType = ref<GrowthType>('power')
// Linear growth: Nth-percentile of the trailing MA slopes. `slopeRangeDays` is
// how far back to gather samples; `slopeWindowDays` is the span each slope is
// measured over (daily/weekly/monthly/yearly preset).
const slopeRangeDays = ref(DEFAULT_SLOPE_RANGE_DAYS)
const slopeWindowDays = ref(DEFAULT_SLOPE_WINDOW_DAYS)
const slopePercentile = ref(DEFAULT_SLOPE_PERCENTILE)
const SLOPE_WINDOW_PRESETS = [
  { label: 'Daily', days: 1 },
  { label: 'Weekly', days: 7 },
  { label: 'Monthly', days: 30 },
  { label: 'Yearly', days: 365 },
]
const envelopeType = ref<EnvelopeType>('value-exponential-decay')
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
  p.linRate = f.linRate
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

// Calibration inputs re-fit the growth curve so changes apply immediately.
// (The C/α/β boxes remain manual overrides until the next recalibration.)
watch(
  [
    maWindow,
    dayZero,
    fitWindowDays,
    powFitGamma,
    slopeRangeDays,
    slopeWindowDays,
    slopePercentile,
  ],
  () => {
    if (seeded) resetToFit()
  },
)

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
  horizonMs: horizonMs.value,
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

// --- Cycle-peak editing -----------------------------------------------------
const horizonMs = computed(() => Date.parse(`${horizonYear.value}-12-31`))
const toISODate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// Sliders span from the first data point to the projection horizon.
const peakMin = computed(() => times.value[0] ?? dayZeroMs.value)
const peakMax = computed(() => horizonMs.value)

const peakMs = (i: number) => Date.parse(peakDates.value[i])

function onPeakInput(i: number, ev: Event) {
  const ms = Number((ev.target as HTMLInputElement).value)
  const clamped = Math.min(Math.max(ms, peakMin.value), peakMax.value)
  peakDates.value[i] = toISODate(clamped)
}

function addPeak() {
  // Place the new top ~one halving cycle (≈3.84 yr) past the last one.
  const last = peakDatesMs.value[peakDatesMs.value.length - 1]
  const base = last != null ? last + 1402 * DAY_MS : Date.parse(nowDate)
  const ms = Math.min(Math.max(base, peakMin.value), peakMax.value)
  peakDates.value = [...peakDates.value, toISODate(ms)].sort()
}

function removePeak(i: number) {
  peakDates.value = peakDates.value.filter((_, j) => j !== i)
}

function clearPeaks() {
  peakDates.value = []
}

function resetPeaks() {
  peakDates.value = [...DEFAULT_PEAK_DATES]
}

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
  { id: 'envelope', label: 'Volatility' },
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

const chartSeries = computed(() => {
  const f = forecast.value
  if (!f) return []
  switch (chartTab.value) {
    case 'baseline':
      return [
        { name: 'Actual 4yr MA', data: f.actualMa, color: C_ORANGE, width: 1.8, bounds: true },
        { name: 'Model baseline (growth fit)', data: f.modelMa, color: C_BLUE },
      ]
    case 'ratio':
      return [
        { name: 'Actual price ÷ MA', data: actualRatio.value, color: C_ORANGE, width: 1.4, bounds: true },
        { name: 'Model price ÷ MA', data: f.priceOverMa, color: C_VIOLET, dashed: true },
      ]
    case 'envelope':
      return [
        { name: 'Actual price ÷ MA', data: actualRatio.value, color: C_ORANGE, width: 1.2, bounds: true },
        { name: 'Volatility projection (max)', data: f.envelope, color: C_TEAL, width: 1.8, bounds: true },
      ]
    default:
      return [
        { name: 'Value baseline (4yr MA)', data: f.modelMa, color: C_BLUE },
        { name: 'Projected price', data: f.projected, color: C_VIOLET, dashed: true },
        { name: 'Actual', data: f.actual, color: C_ORANGE, width: 1.8, bounds: true },
      ]
  }
})

const chartFormat = computed<'usd' | 'ratio'>(() =>
  chartTab.value === 'ratio' || chartTab.value === 'envelope' ? 'ratio' : 'usd',
)

// Price-tab shaded band: lower = value baseline (modelMa), upper = the same
// baseline lifted by the volatility envelope (modelMa × envelope). Shows the
// projection's plausible range as a cone that widens/narrows with volatility.
const chartBand = computed(() => {
  const f = forecast.value
  if (!f || chartTab.value !== 'price') return undefined
  return {
    lower: f.modelMa,
    upper: f.modelMa.map((m, i) => m * f.envelope[i]),
    color: C_BLUE,
  }
})

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
const slopeRangeLabel = computed(() =>
  slopeRangeDays.value > 0
    ? `the last ${slopeRangeDays.value} days (≈ ${(slopeRangeDays.value / 365).toFixed(1)} yr)`
    : 'all history',
)
const slopeWindowLabel = computed(() => {
  const preset = SLOPE_WINDOW_PRESETS.find((p) => p.days === slopeWindowDays.value)
  return preset ? preset.label.toLowerCase() : `${slopeWindowDays.value}-day`
})

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
      <span class="muted"> · {{ growthType }} growth · {{ envelopeType }} volatility</span>
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
        Growth projection <InfoTip term="growthModel" />
        <select v-model="growthType">
          <option value="power">Time-based power-law</option>
          <option value="exponential">Time-based exponential</option>
          <option value="linear">Time-based linear</option>
        </select>
      </label>
      <label>
        Volatility projection <InfoTip term="envelope" />
        <select v-model="envelopeType">
          <option value="exponential-decay">Time-based exponential decay</option>
          <option value="value-power-decay">Value-based power decay</option>
          <option value="value-exponential-decay">Value-based exponential decay</option>
          <option value="constant">Constant</option>
        </select>
      </label>
      <label>
        Cycle peaks <InfoTip term="cyclePeaks" />
        <select v-model="distributionType">
          <option value="peaks">Laplacian</option>
          <option value="none">None</option>
        </select>
      </label>
      <label>
        Horizon <InfoTip term="horizon" />
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
    </section>

    <!-- Calibration: knobs that drive the auto-fit and overwrite the model
         parameters below (same effect as "Reset to fit"). -->
    <section class="params calibration">
      <h3>
        Calibration
        <span class="fit">auto-fits the model parameters below</span>
      </h3>
      <div class="param-grid">
        <label>
          Baseline MA window (days) <InfoTip term="valueBaseline" />
          <input type="number" v-model.number="maWindow" min="30" max="3000" step="5" />
        </label>
        <label>
          Growth fit window (days, 0 = all)
          <input type="number" v-model.number="fitWindowDays" min="0" max="6000" step="50" />
        </label>
        <label>
          Day zero (t₀) <InfoTip term="dayZero" />
          <input type="date" v-model="dayZero" />
        </label>
        <label v-if="growthType === 'power'">
          Recency weighting γ <InfoTip term="recency" />
          <input type="number" v-model.number="powFitGamma" min="0" max="2" step="0.05" />
        </label>
        <button class="reset" @click="resetToFit">↺ Reset to fit</button>
      </div>
      <p class="calib-note">
        MA ≈ {{ maYears }} yr · growth fit on {{ fitWindowLabel }}.
        <template v-if="growthType === 'power'">
          γ=0 weights every sample equally · γ=1 every log-time decade.
        </template>
        Changing any calibration knob re-fits the model and overwrites the
        parameter boxes below — hand-edits persist only until the next re-fit.
      </p>
    </section>

    <!-- Model parameters: hand-tunable, persist until the next calibration -->
    <section class="params">
      <h3>
        Value baseline — growth
        <span class="fit-note">auto-filled · editable</span>
      </h3>

      <template v-if="growthType === 'exponential'">
        <h4>
          Exponential
          <span class="fit" v-if="fitted">R² {{ fitted.expR2.toFixed(4) }}</span>
        </h4>
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
        <h4>
          Power-law
          <span class="fit" v-if="fitted">R² {{ fitted.powR2.toFixed(4) }}</span>
        </h4>
        <div class="param-grid">
          <label>
            Constant C
            <input type="number" v-model.number="p.powConstant" step="any" />
          </label>
          <label>
            Power β
            <input type="number" v-model.number="p.powExponent" step="any" />
          </label>
        </div>
        <p class="eq">MA = C · (x + 1)^β</p>
      </template>

      <template v-else>
        <h4>Linear</h4>
        <div class="param-grid">
          <label>
            Rate (per day)
            <input type="number" v-model.number="p.linRate" step="any" />
          </label>
          <label>
            Slope range (days, 0 = all)
            <input
              type="number"
              v-model.number="slopeRangeDays"
              min="0"
              max="6000"
              step="30"
            />
          </label>
          <label>
            Slope window
            <select v-model.number="slopeWindowDays">
              <option v-for="w in SLOPE_WINDOW_PRESETS" :key="w.days" :value="w.days">
                {{ w.label }}
              </option>
            </select>
          </label>
          <label>
            Slope percentile
            <input
              type="number"
              v-model.number="slopePercentile"
              min="0"
              max="100"
              step="1"
            />
          </label>
        </div>
        <p class="fit-note" v-if="fitted">
          Rate auto-fills from the {{ slopePercentile }}ᵗʰ-percentile
          {{ slopeWindowLabel }} slope over {{ slopeRangeLabel }}
          ({{ fmtNum(fitted.linRate) }} /day) — re-fits on change.
        </p>
        <p class="eq">MA = last_MA + rate · Δt</p>
      </template>
    </section>

    <!-- Model parameters: volatility -->
    <section class="params">
      <h3>
        Volatility projection
        <span class="fit-note">
          {{ envelopeType === 'exponential-decay' ? 'auto-filled · editable' : 'manual' }}
        </span>
      </h3>
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
        <h3>
          Cycle peaks
          <span class="fit">{{ peakDates.length }} tops</span>
        </h3>
        <div class="param-grid">
          <label>
            Spread
            <input type="number" v-model.number="peakSpread" step="any" min="0.0001" />
          </label>
          <div class="peak-actions">
            <button type="button" @click="addPeak">+ Add</button>
            <button type="button" @click="resetPeaks">↺ Default</button>
            <button type="button" @click="clearPeaks" :disabled="!peakDates.length">
              Clear all
            </button>
          </div>
        </div>

        <ul class="peak-list">
          <li v-for="(d, i) in peakDates" :key="i" class="peak-row">
            <span class="peak-date">{{ d }}</span>
            <input
              class="peak-slider"
              type="range"
              :min="peakMin"
              :max="peakMax"
              :step="DAY_MS"
              :value="peakMs(i)"
              @input="onPeakInput(i, $event)"
            />
            <button
              type="button"
              class="peak-remove"
              title="Remove peak"
              @click="removePeak(i)"
            >
              ×
            </button>
          </li>
          <li v-if="!peakDates.length" class="fit-note">
            No peaks — projection follows the baseline volatility only.
          </li>
        </ul>
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
      :value-format="chartFormat"
      :band="chartBand"
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
.params h4 {
  margin: 0.5rem 0 0.4rem;
  font-size: 0.76rem;
  color: var(--text);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.params h4 .fit {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.72rem;
}
/* Calibration section: visually set apart from the manual model params. */
.calibration {
  border-color: var(--accent-violet);
  background: rgba(155, 109, 255, 0.06);
}
.calibration h3 {
  color: var(--accent-violet);
}
.calibration .param-grid {
  align-items: flex-end;
}
.calib-note {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin: 0.55rem 0 0;
  line-height: 1.45;
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
.peak-actions {
  display: flex;
  gap: 0.35rem;
  align-self: center;
}
.peak-actions button {
  font-size: 0.72rem;
  padding: 0.25rem 0.55rem;
}
.peak-list {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.peak-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.peak-date {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  color: var(--text);
  width: 6.2rem;
  flex: none;
}
.peak-slider {
  flex: 1;
  min-width: 8rem;
  accent-color: var(--accent-violet);
}
.peak-remove {
  flex: none;
  line-height: 1;
  padding: 0.1rem 0.45rem;
  color: var(--text-muted);
}
.peak-remove:hover {
  color: #fff;
  border-color: var(--accent-violet);
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
