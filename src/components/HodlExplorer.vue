<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, shallowRef, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { PricePoint, FetchProgress } from '../api/bitcoin'
import { sma } from '../lib/indicators'
import { scaleDiag } from '../lib/runs'
import {
  type Band,
  type DriverId,
  ratioSeries,
  windowIndices,
  selectBandBuyDates,
  simulateStrategy,
} from '../lib/hodl'

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
  CanvasRenderer,
])

const GROUP = 'btc-hodl'
const UP = '#2bd4a7'
const BAND_FILL = 'rgba(43, 212, 167, 0.14)'

// Bollinger-score driver uses a fixed monthly-ish scale, matching the Price
// Explorer's default run scale (hd ≈ 31d, N = 20).
const B_SCALE_HD = 31
const B_SCALE_N = 20

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
  error: string
  progress: FetchProgress
  /** Shared with Price Explorer — same long MA baseline. */
  ratioMaDays: number
}>()

const emit = defineEmits<{
  'update:ratioMaDays': [value: number]
  refresh: []
}>()

// --- Controls ---------------------------------------------------------------
const driver = ref<DriverId>('ratio')
const baselineDays = ref(1460) // trailing comparison window (default 4yr)

// Each driver carries its own buy band [lower, upper].
const ratioLower = ref(0.3)
const ratioUpper = ref(0.85)
const bLower = ref(-4)
const bUpper = ref(-0.5)

// MA window: synced with Price Explorer via prop + emit.
const localMaDays = computed({
  get: () => props.ratioMaDays,
  set: (v) => emit('update:ratioMaDays', v),
})

// --- Derived data -----------------------------------------------------------
function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const dates = computed(() => props.raw.map((p) => toDateInput(p.time)))
const prices = computed(() => props.raw.map((p) => p.price))
const longMa = computed(() => sma(prices.value, props.ratioMaDays))

const maLabel = computed(() => {
  const yr = props.ratioMaDays / 365
  return yr >= 1 ? `${yr.toFixed(1)}yr` : `${props.ratioMaDays}d`
})

// The active driver's metric series + its band.
const bDiag = computed(() => scaleDiag(prices.value, B_SCALE_HD, { N: B_SCALE_N }))
const metricSeries = computed<(number | null)[]>(() =>
  driver.value === 'ratio' ? ratioSeries(prices.value, longMa.value) : bDiag.value.b,
)
const band = computed<Band>(() =>
  driver.value === 'ratio'
    ? { lower: ratioLower.value, upper: ratioUpper.value }
    : { lower: bLower.value, upper: bUpper.value },
)
const metricTitle = computed(() =>
  driver.value === 'ratio' ? `Price ÷ MA (${maLabel.value})` : `Bollinger score (b · monthly)`,
)

// Comparison window — both strategy and baseline buy only within these days.
const windowStart = computed(() => Math.max(0, prices.value.length - baselineDays.value))
const windowSize = computed(() => prices.value.length - windowStart.value)
const candidates = computed(() => windowIndices(prices.value.length, baselineDays.value))

const strategyIndices = computed(() =>
  selectBandBuyDates(metricSeries.value, band.value, candidates.value),
)
const strategyStats = computed(() =>
  simulateStrategy(prices.value, strategyIndices.value, 1, windowSize.value),
)
const baselineStats = computed(() =>
  simulateStrategy(prices.value, candidates.value, 1, windowSize.value),
)

// Scatter data: [date, price] for each buy index (main chart).
const strategyBuyPoints = computed(() =>
  strategyIndices.value.map((i) => [dates.value[i], prices.value[i]]),
)
// Scatter data: [date, metric] for each buy index (driver chart).
const metricBuyPoints = computed(() =>
  strategyIndices.value.map((i) => [dates.value[i], metricSeries.value[i]]),
)

const latestPrice = computed(() =>
  prices.value.length ? prices.value[prices.value.length - 1] : null,
)

const fmtUSD = (v: number | null) =>
  v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtPct = (v: number | null) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'
const fmtBtc = (v: number | null) => (v == null ? '—' : v.toFixed(6) + ' BTC')

// --- Price chart ------------------------------------------------------------
const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()

function buildPriceOption(): echarts.EChartsCoreOption {
  const AXIS = '#8b94ac'
  const SPLIT = 'rgba(54, 66, 95, 0.45)'
  const cats = dates.value
  const p = prices.value
  const bStart = windowStart.value

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 60, right: 16, top: 48, bottom: 60 },
    legend: {
      data: ['Price', `Long MA (${maLabel.value})`, 'Strategy buys', 'Baseline window'],
      top: 8,
      textStyle: { color: '#e7eaf3' },
      inactiveColor: '#5a6480',
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,27,42,0.95)',
      borderColor: '#36425f',
      textStyle: { color: '#e7eaf3' },
      formatter: (params: any) => {
        const i = params[0]?.dataIndex
        if (i == null) return ''
        const rows = [`<strong>${cats[i]}</strong>`, `Price: ${fmtUSD(p[i])}`]
        const m = longMa.value[i]
        if (m) rows.push(`Long MA: ${fmtUSD(m)}`)
        return rows.join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      data: cats,
      boundaryGap: false,
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, formatter: (v: number) => fmtUSD(v) },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, bottom: 8, height: 14, borderColor: '#36425f', fillerColor: 'rgba(79,142,247,0.18)', textStyle: { color: AXIS, fontSize: 9 } },
    ],
    series: [
      {
        name: 'Baseline window',
        type: 'line',
        data: cats.map((_, i) => (i >= bStart ? p[i] : null)),
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(100, 120, 180, 0.12)' },
        silent: true,
        z: 1,
      },
      {
        name: `Long MA (${maLabel.value})`,
        type: 'line',
        data: longMa.value,
        symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.2, type: 'dashed' },
        z: 2,
      },
      {
        name: 'Price',
        type: 'line',
        data: p,
        symbol: 'none',
        lineStyle: { color: '#f7931a', width: 1.5 },
        z: 3,
      },
      {
        name: 'Strategy buys',
        type: 'scatter',
        data: strategyBuyPoints.value,
        symbolSize: 5,
        itemStyle: { color: UP, opacity: 0.8 },
        z: 4,
      },
    ],
  }
}

// --- Driver-metric chart (with buy band shaded) -----------------------------
const elMetric = ref<HTMLDivElement>()
const chartMetric = shallowRef<echarts.ECharts>()

function buildMetricOption(): echarts.EChartsCoreOption {
  const AXIS = '#8b94ac'
  const SPLIT = 'rgba(54, 66, 95, 0.45)'
  const cats = dates.value
  const b = band.value
  const lo = Math.min(b.lower, b.upper)
  const hi = Math.max(b.lower, b.upper)
  const startDate = cats[windowStart.value]

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 60, right: 16, top: 34, bottom: 28 },
    title: {
      left: 60,
      top: 6,
      text: `${metricTitle.value} — buy band shaded`,
      textStyle: { color: '#cdd3e4', fontSize: 11, fontWeight: 'normal' },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,27,42,0.95)',
      borderColor: '#36425f',
      textStyle: { color: '#e7eaf3' },
      formatter: (params: any) => {
        const i = params[0]?.dataIndex
        if (i == null) return ''
        const v = metricSeries.value[i]
        return `<strong>${cats[i]}</strong><br/>${metricTitle.value}: ${v == null ? '—' : v.toFixed(3)}`
      },
    },
    xAxis: {
      type: 'category',
      data: cats,
      boundaryGap: false,
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, fontSize: 9 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, fontSize: 9 },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    dataZoom: [{ type: 'inside', start: 0, end: 100 }],
    series: [
      {
        name: metricTitle.value,
        type: 'line',
        data: metricSeries.value,
        symbol: 'none',
        lineStyle: { color: '#f7931a', width: 1.3 },
        // Buy band: shade the y-range [lo, hi]; mark the comparison-window start.
        markArea: {
          silent: true,
          itemStyle: { color: BAND_FILL },
          data: [[{ yAxis: lo }, { yAxis: hi }]],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: '#5a6480', type: 'dashed' },
          data: startDate ? [{ xAxis: startDate }] : [],
        },
        z: 2,
      },
      {
        name: 'Strategy buys',
        type: 'scatter',
        data: metricBuyPoints.value,
        symbolSize: 5,
        itemStyle: { color: UP, opacity: 0.85 },
        z: 3,
      },
    ],
  }
}

function render() {
  chart.value?.setOption(buildPriceOption(), { replaceMerge: ['series'] })
  chartMetric.value?.setOption(buildMetricOption(), { replaceMerge: ['series'] })
}

onMounted(async () => {
  if (el.value) {
    chart.value = echarts.init(el.value)
    chart.value.group = GROUP
  }
  if (elMetric.value) {
    chartMetric.value = echarts.init(elMetric.value)
    chartMetric.value.group = GROUP
  }
  render()
  echarts.connect(GROUP)
  await nextTick()
  chart.value?.resize()
  chartMetric.value?.resize()
  if (el.value) resizeObserver.observe(el.value)
  if (elMetric.value) resizeObserver.observe(elMetric.value)
})
const resizeObserver = new ResizeObserver(() => {
  chart.value?.resize()
  chartMetric.value?.resize()
})
onBeforeUnmount(() => {
  resizeObserver.disconnect()
  chart.value?.dispose()
  chartMetric.value?.dispose()
})
watch(
  () => [
    props.raw,
    props.ratioMaDays,
    driver.value,
    band.value,
    baselineDays.value,
  ],
  render,
)
</script>

<template>
  <div>
    <p class="latest" v-if="latestPrice">
      Latest close: <strong>{{ fmtUSD(latestPrice) }}</strong>
    </p>

    <section class="status" v-if="loading">
      Loading… {{ progress.bars }} bars over {{ progress.pages }} page(s)
    </section>
    <section class="status error" v-else-if="error">
      ⚠️ {{ error }} <button @click="emit('refresh')">Retry</button>
    </section>

    <!-- Controls -->
    <section class="controls">
      <label class="ctrl-label">
        Driver
        <select v-model="driver" class="select">
          <option value="ratio">Price ÷ MA</option>
          <option value="bscore">Bollinger score (b)</option>
        </select>
      </label>

      <label v-if="driver === 'ratio'" class="ctrl-label">
        MA window
        <span class="ctrl-row">
          <input
            type="number"
            :value="localMaDays"
            @input="localMaDays = Number(($event.target as HTMLInputElement).value)"
            min="30"
            max="2000"
            step="10"
            class="num-input"
          />
          <span class="unit">d · {{ maLabel }}</span>
        </span>
      </label>

      <!-- Buy band: lower / upper bounds for the active driver. -->
      <label class="ctrl-label" v-if="driver === 'ratio'">
        Buy band (price ÷ MA)
        <span class="ctrl-row">
          <input type="number" v-model.number="ratioLower" min="0" max="3" step="0.01" class="num-input sm" />
          <span class="unit">to</span>
          <input type="number" v-model.number="ratioUpper" min="0" max="3" step="0.01" class="num-input sm" />
        </span>
      </label>
      <label class="ctrl-label" v-else>
        Buy band (b score)
        <span class="ctrl-row">
          <input type="number" v-model.number="bLower" min="-8" max="8" step="0.1" class="num-input sm" />
          <span class="unit">to</span>
          <input type="number" v-model.number="bUpper" min="-8" max="8" step="0.1" class="num-input sm" />
        </span>
      </label>

      <label class="ctrl-label">
        Window (trailing)
        <span class="ctrl-row">
          <input type="number" v-model.number="baselineDays" min="30" max="5000" step="30" class="num-input" />
          <span class="unit">days</span>
        </span>
      </label>
    </section>

    <!-- Price chart with buy markers -->
    <div ref="el" class="chart"></div>

    <!-- Driver-metric chart with the buy band shaded -->
    <div ref="elMetric" class="chart metric"></div>

    <!-- Stats comparison -->
    <section class="stats" v-if="strategyStats && baselineStats">
      <div class="stat-col">
        <h3 class="col-head strategy">Strategy</h3>
        <p class="col-sub">{{ strategyStats.numBuys }} buys · {{ (strategyStats.coverage * 100).toFixed(1) }}% of window</p>
        <div class="stat-row">
          <span class="stat-label">Current value</span>
          <span class="stat-val">{{ fmtUSD(strategyStats.currentValue) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">ROI</span>
          <span class="stat-val" :class="strategyStats.roi >= 0 ? 'pos' : 'neg'">{{ fmtPct(strategyStats.roi) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Cost basis</span>
          <span class="stat-val">{{ fmtUSD(strategyStats.costBasis) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">BTC held</span>
          <span class="stat-val">{{ fmtBtc(strategyStats.btcAccumulated) }}</span>
        </div>
      </div>

      <div class="stat-col">
        <h3 class="col-head baseline">Baseline</h3>
        <p class="col-sub">Every day · last {{ baselineDays }} days</p>
        <div class="stat-row">
          <span class="stat-label">Current value</span>
          <span class="stat-val">{{ fmtUSD(baselineStats.currentValue) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">ROI</span>
          <span class="stat-val" :class="baselineStats.roi >= 0 ? 'pos' : 'neg'">{{ fmtPct(baselineStats.roi) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Cost basis</span>
          <span class="stat-val">{{ fmtUSD(baselineStats.costBasis) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">BTC held</span>
          <span class="stat-val">{{ fmtBtc(baselineStats.btcAccumulated) }}</span>
        </div>
      </div>

      <div class="stat-col edge">
        <h3 class="col-head">Edge</h3>
        <p class="col-sub">Strategy vs baseline</p>
        <div class="stat-row">
          <span class="stat-label">Value edge</span>
          <span class="stat-val" :class="strategyStats.currentValue >= baselineStats.currentValue ? 'pos' : 'neg'">
            {{ fmtPct((strategyStats.currentValue - baselineStats.currentValue) / baselineStats.currentValue) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">ROI edge</span>
          <span class="stat-val" :class="strategyStats.roi >= baselineStats.roi ? 'pos' : 'neg'">
            {{ fmtPct(strategyStats.roi - baselineStats.roi) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Cost basis edge</span>
          <span class="stat-val" :class="strategyStats.costBasis <= baselineStats.costBasis ? 'pos' : 'neg'">
            {{ fmtPct((baselineStats.costBasis - strategyStats.costBasis) / baselineStats.costBasis) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">BTC edge</span>
          <span class="stat-val" :class="strategyStats.btcAccumulated >= baselineStats.btcAccumulated ? 'pos' : 'neg'">
            {{ fmtPct((strategyStats.btcAccumulated - baselineStats.btcAccumulated) / baselineStats.btcAccumulated) }}
          </span>
        </div>
      </div>
    </section>

    <section class="no-buys" v-else-if="!loading && !error && !strategyStats">
      <p>No qualifying buy days in the window for this band. Widen the band or the window.</p>
    </section>

    <p class="hint">
      Strategy: buy equally on every day in the trailing {{ baselineDays }} days whose
      {{ driver === 'ratio' ? 'price ÷ MA' : 'Bollinger score' }} falls in the buy band.
      Baseline: buy equally on every day of that same window. Same total budget on both
      sides — the comparison is purely about <em>which</em> days.
    </p>
  </div>
</template>

<style scoped>
.latest {
  margin: 0 0 0.75rem;
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

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}
.ctrl-label {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: var(--text-muted);
  gap: 0.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.4rem 0.55rem;
  background: var(--bg-elev);
}
.ctrl-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.select {
  width: 11rem;
}
.num-input {
  width: 5rem;
}
.num-input.sm {
  width: 4rem;
}
.unit {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.chart {
  width: 100%;
  height: min(54vh, 460px);
  margin-bottom: 0.5rem;
}
.chart.metric {
  height: min(28vh, 220px);
  margin-bottom: 1rem;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.stat-col {
  flex: 1;
  min-width: 9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem 0.75rem;
  background: var(--bg-elev);
}
.col-head {
  margin: 0 0 0.2rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
}
.col-head.strategy {
  color: #2bd4a7;
}
.col-head.baseline {
  color: #4f8ef7;
}
.col-sub {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  color: var(--text-muted);
}
.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.15rem 0;
  border-top: 1px solid var(--border);
  font-size: 0.78rem;
}
.stat-label {
  color: var(--text-muted);
  flex-shrink: 0;
}
.stat-val {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.pos {
  color: #2bd4a7;
}
.neg {
  color: #f74b4b;
}

.no-buys {
  padding: 0.75rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.hint {
  color: var(--text-muted);
  font-size: 0.78rem;
  margin-top: 0.5rem;
}
</style>
