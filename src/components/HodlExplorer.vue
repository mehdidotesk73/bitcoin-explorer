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
  type SeedKind,
  type SeedLayer,
  ratioSeries,
  selectBandBuyDates,
  simulateStrategy,
  unionIndices,
  snapDateToIndex,
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
const AMBER = '#fbbf24'
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

// --- Builder controls -------------------------------------------------------
const driver = ref<SeedKind>('ratio')

// Comparison window: either trailing-X-days-from-today, or an explicit from/to.
const windowMode = ref<'trailing' | 'range'>('trailing')
const baselineDays = ref(1460) // trailing comparison window (default 4yr)
const fromDate = ref('')
const toDate = ref('')

// Each indicator driver carries its own buy band [lower, upper].
const ratioLower = ref(0.3)
const ratioUpper = ref(0.85)
const bLower = ref(-4)
const bUpper = ref(-0.5)

// Manual driver: a working list of dates being assembled before "Add layer".
const manualDates = ref<string[]>([])
const manualDateInput = ref('')

// The seed combinator: stored layers, unioned into the final strategy.
const layers = ref<SeedLayer[]>([])

// Total purchase budget in cash; defaults to the current BTC price once known.
const totalBudget = ref(0)
let budgetInitialised = false

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

// b-score series (fixed monthly scale).
const bDiag = computed(() => scaleDiag(prices.value, B_SCALE_HD, { N: B_SCALE_N }))

// Comparison window — baseline + all layers operate within [start, end] (incl.).
const windowRange = computed<{ start: number; end: number }>(() => {
  const n = prices.value.length
  if (!n) return { start: 0, end: -1 }
  if (windowMode.value === 'range') {
    let s = fromDate.value ? (snapDateToIndex(dates.value, fromDate.value) ?? 0) : 0
    let e = toDate.value ? (snapDateToIndex(dates.value, toDate.value) ?? n - 1) : n - 1
    if (s > e) [s, e] = [e, s]
    return { start: s, end: e }
  }
  return { start: Math.max(0, n - baselineDays.value), end: n - 1 }
})
const windowSize = computed(() => Math.max(0, windowRange.value.end - windowRange.value.start + 1))
const inWindow = (i: number) => i >= windowRange.value.start && i <= windowRange.value.end
const candidates = computed(() => {
  const { start, end } = windowRange.value
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
})

const latestPrice = computed(() =>
  prices.value.length ? prices.value[prices.value.length - 1] : null,
)

// Initialise budget (to the current price) + the from/to range the first time
// data lands.
watch(
  latestPrice,
  (p) => {
    if (!budgetInitialised && p) {
      totalBudget.value = Math.round(p)
      const n = prices.value.length
      if (n) {
        fromDate.value = dates.value[Math.max(0, n - baselineDays.value)]
        toDate.value = dates.value[n - 1]
      }
      budgetInitialised = true
    }
  },
  { immediate: true },
)

// --- Builder: the active driver's metric series, band, and live preview -----
const builderBand = computed<Band>(() =>
  driver.value === 'bscore'
    ? { lower: bLower.value, upper: bUpper.value }
    : { lower: ratioLower.value, upper: ratioUpper.value },
)
const builderMetric = computed<(number | null)[]>(() =>
  driver.value === 'bscore' ? bDiag.value.b : ratioSeries(prices.value, longMa.value),
)
const metricTitle = computed(() =>
  driver.value === 'bscore' ? 'Bollinger score (b · monthly)' : `Price ÷ MA (${maLabel.value})`,
)
const showMetricChart = computed(() => driver.value !== 'manual')

// Manual: resolve the working dates to unique sorted day indices.
const manualPendingIndices = computed(() => {
  const idx = manualDates.value
    .map((d) => snapDateToIndex(dates.value, d))
    .filter((i): i is number => i != null)
  return [...new Set(idx)].sort((a, b) => a - b)
})

// Live preview of what the builder would add as a layer (manual is filtered to
// the window — out-of-window dates are excluded from the strategy).
const previewIndices = computed(() => {
  if (driver.value === 'manual') return manualPendingIndices.value.filter(inWindow)
  return selectBandBuyDates(builderMetric.value, builderBand.value, candidates.value)
})

// --- Combinator: each layer is a STATIC set of day indices (resolved once at
// add-time and frozen). The window only filters which stored days count — the
// driver parameters never re-tune an existing layer.
function resolveLayer(layer: SeedLayer): number[] {
  return (layer.dateIndices ?? []).filter(inWindow)
}
function layerActive(layer: SeedLayer): number {
  return resolveLayer(layer).length
}
function layerTotal(layer: SeedLayer): number {
  return (layer.dateIndices ?? []).length
}

// Manual dates (committed layers + pending) that fall OUTSIDE the window. They
// are still stored on the layer; they're just ignored in the totals until the
// window covers them. Surfaced as an informational note only.
const outOfWindowDates = computed<string[]>(() => {
  const bad = new Set<number>()
  for (const l of layers.value) {
    if (l.kind === 'manual') for (const i of l.dateIndices ?? []) if (!inWindow(i)) bad.add(i)
  }
  for (const i of manualPendingIndices.value) if (!inWindow(i)) bad.add(i)
  return [...bad].sort((a, b) => a - b).map((i) => dates.value[i])
})

const strategyIndices = computed(() => unionIndices(layers.value.map(resolveLayer)))

const strategyStats = computed(() =>
  simulateStrategy(prices.value, strategyIndices.value, totalBudget.value, windowSize.value),
)
const baselineStats = computed(() =>
  simulateStrategy(prices.value, candidates.value, totalBudget.value, windowSize.value),
)

// --- Layer management -------------------------------------------------------
function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `l_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// Can we commit the current builder as a layer? Manual: any pending date (even
// out-of-window). Indicator: any in-window match.
const canAddLayer = computed(() =>
  driver.value === 'manual'
    ? manualPendingIndices.value.length > 0
    : previewIndices.value.length > 0,
)
const addCount = computed(() =>
  driver.value === 'manual' ? manualPendingIndices.value.length : previewIndices.value.length,
)

function addLayer() {
  if (!canAddLayer.value) return
  const n = prices.value.length
  const all = Array.from({ length: n }, (_, i) => i)
  if (driver.value === 'manual') {
    // Store ALL chosen dates (in- and out-of-window); the window filters later.
    layers.value.push({
      id: newId(),
      kind: 'manual',
      label: `Manual · ${manualPendingIndices.value.length} date(s)`,
      dateIndices: [...manualPendingIndices.value],
    })
    manualDates.value = []
    manualDateInput.value = ''
  } else if (driver.value === 'ratio') {
    // Resolve over ALL history at add-time → a frozen seed independent of the
    // driver knobs (band/MA window) from here on.
    const metric = ratioSeries(prices.value, sma(prices.value, props.ratioMaDays))
    layers.value.push({
      id: newId(),
      kind: 'ratio',
      label: `Price÷MA ${ratioLower.value}–${ratioUpper.value} · ${maLabel.value}`,
      dateIndices: selectBandBuyDates(metric, builderBand.value, all),
    })
  } else {
    layers.value.push({
      id: newId(),
      kind: 'bscore',
      label: `b score ${bLower.value}–${bUpper.value}`,
      dateIndices: selectBandBuyDates(bDiag.value.b, builderBand.value, all),
    })
  }
}
function removeLayer(id: string) {
  layers.value = layers.value.filter((l) => l.id !== id)
}
function clearLayers() {
  layers.value = []
}

// Manual date chips.
function addManualDate() {
  const d = manualDateInput.value
  if (d && !manualDates.value.includes(d)) manualDates.value.push(d)
  manualDateInput.value = ''
}
function removeManualDate(d: string) {
  manualDates.value = manualDates.value.filter((x) => x !== d)
}

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
  const { start: bStart, end: bEnd } = windowRange.value

  const committed = strategyIndices.value.map((i) => [cats[i], p[i]])
  const preview = previewIndices.value.map((i) => [cats[i], p[i]])

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 60, right: 16, top: 48, bottom: 60 },
    legend: {
      data: ['Price', `Long MA (${maLabel.value})`, 'Strategy buys', 'Preview', 'Baseline window'],
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
        data: cats.map((_, i) => (i >= bStart && i <= bEnd ? p[i] : null)),
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
        name: 'Preview',
        type: 'scatter',
        data: preview,
        symbolSize: 6,
        itemStyle: { color: 'rgba(0,0,0,0)', borderColor: AMBER, borderWidth: 1.4 },
        z: 4,
      },
      {
        name: 'Strategy buys',
        type: 'scatter',
        data: committed,
        symbolSize: 5,
        itemStyle: { color: UP, opacity: 0.85 },
        z: 5,
      },
    ],
  }
}

// --- Driver-metric chart (buy band shaded) ----------------------------------
const elMetric = ref<HTMLDivElement>()
const chartMetric = shallowRef<echarts.ECharts>()

function buildMetricOption(): echarts.EChartsCoreOption {
  const AXIS = '#8b94ac'
  const SPLIT = 'rgba(54, 66, 95, 0.45)'
  const cats = dates.value
  const b = builderBand.value
  const lo = Math.min(b.lower, b.upper)
  const hi = Math.max(b.lower, b.upper)
  const { start: wStart, end: wEnd } = windowRange.value
  const edges = [cats[wStart], cats[wEnd]].filter(Boolean).map((d) => ({ xAxis: d }))
  const preview = previewIndices.value.map((i) => [cats[i], builderMetric.value[i]])

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
        const v = builderMetric.value[i]
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
        data: builderMetric.value,
        symbol: 'none',
        lineStyle: { color: '#f7931a', width: 1.3 },
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
          data: edges,
        },
        z: 2,
      },
      {
        name: 'Preview',
        type: 'scatter',
        data: preview,
        symbolSize: 5,
        itemStyle: { color: AMBER, opacity: 0.9 },
        z: 3,
      },
    ],
  }
}

function render() {
  chart.value?.setOption(buildPriceOption(), { replaceMerge: ['series'] })
  if (showMetricChart.value) {
    chartMetric.value?.setOption(buildMetricOption(), { replaceMerge: ['series'] })
    chartMetric.value?.resize()
  }
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
    builderBand.value,
    windowMode.value,
    baselineDays.value,
    fromDate.value,
    toDate.value,
    strategyIndices.value,
    previewIndices.value,
  ],
  async () => {
    await nextTick()
    render()
  },
  { deep: true },
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

    <!-- Builder -->
    <section class="builder">
      <div class="controls">
        <label class="ctrl-label">
          Driver
          <select v-model="driver" class="select">
            <option value="ratio">Price ÷ MA</option>
            <option value="bscore">Bollinger score (b)</option>
            <option value="manual">Manual seeding</option>
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

        <label class="ctrl-label" v-if="driver === 'ratio'">
          Buy band (price ÷ MA)
          <span class="ctrl-row">
            <input type="number" v-model.number="ratioLower" min="0" max="3" step="0.01" class="num-input sm" />
            <span class="unit">to</span>
            <input type="number" v-model.number="ratioUpper" min="0" max="3" step="0.01" class="num-input sm" />
          </span>
        </label>
        <label class="ctrl-label" v-else-if="driver === 'bscore'">
          Buy band (b score)
          <span class="ctrl-row">
            <input type="number" v-model.number="bLower" min="-8" max="8" step="0.1" class="num-input sm" />
            <span class="unit">to</span>
            <input type="number" v-model.number="bUpper" min="-8" max="8" step="0.1" class="num-input sm" />
          </span>
        </label>
        <div class="ctrl-label" v-else>
          Add dates
          <span class="ctrl-row">
            <input
              type="date"
              v-model="manualDateInput"
              :min="dates[0]"
              :max="dates[dates.length - 1]"
              class="num-input"
            />
            <button class="mini" @click="addManualDate">+ Add</button>
          </span>
          <div class="chips" v-if="manualDates.length">
            <span class="chip" v-for="d in manualDates" :key="d">
              {{ d }} <button class="chip-x" @click="removeManualDate(d)">×</button>
            </span>
          </div>
        </div>

        <button class="add-layer" @click="addLayer" :disabled="!canAddLayer">
          + Add layer ({{ addCount }} day{{ addCount === 1 ? '' : 's' }})
        </button>
      </div>

      <!-- Seed layers (the combinator) -->
      <div class="layers" v-if="layers.length">
        <div class="layers-head">
          <span class="muted">Seed layers — combined into the strategy ({{ strategyIndices.length }} unique days):</span>
          <button class="mini ghost" @click="clearLayers">Clear all</button>
        </div>
        <ul class="layer-list">
          <li v-for="l in layers" :key="l.id" class="layer-item">
            <span class="layer-kind" :class="l.kind">{{ l.kind }}</span>
            <span class="layer-label">{{ l.label }}</span>
            <span class="layer-count">
              {{ layerActive(l) }}<template v-if="layerTotal(l) !== layerActive(l)"> of {{ layerTotal(l) }}</template> days
            </span>
            <button class="chip-x" @click="removeLayer(l.id)">×</button>
          </li>
        </ul>
      </div>
    </section>

    <!-- Out-of-window manual dates: informational only. The seed/layer is still
         kept; these days are simply ignored in the totals until the window
         covers them. -->
    <section class="warn" v-if="outOfWindowDates.length">
      ℹ️ {{ outOfWindowDates.length }} manual date(s) sit outside the comparison
      window and are ignored in the totals (still stored):
      <strong>{{ outOfWindowDates.join(', ') }}</strong>. Widen the window to include them.
    </section>

    <!-- Budget + window -->
    <section class="controls">
      <label class="ctrl-label">
        Total budget (cash)
        <span class="ctrl-row">
          <span class="unit">$</span>
          <input type="number" v-model.number="totalBudget" min="1" step="100" class="num-input" />
        </span>
      </label>

      <label class="ctrl-label">
        Window mode
        <select v-model="windowMode" class="select sm">
          <option value="trailing">Trailing days</option>
          <option value="range">Date range</option>
        </select>
      </label>

      <label class="ctrl-label" v-if="windowMode === 'trailing'">
        Window (trailing from today)
        <span class="ctrl-row">
          <input type="number" v-model.number="baselineDays" min="30" max="5000" step="30" class="num-input" />
          <span class="unit">days</span>
        </span>
      </label>
      <template v-else>
        <label class="ctrl-label">
          From
          <input type="date" v-model="fromDate" :min="dates[0]" :max="dates[dates.length - 1]" class="num-input" />
        </label>
        <label class="ctrl-label">
          To
          <input type="date" v-model="toDate" :min="dates[0]" :max="dates[dates.length - 1]" class="num-input" />
        </label>
      </template>
    </section>

    <!-- Price chart with buy markers -->
    <div ref="el" class="chart"></div>

    <!-- Driver-metric chart with the buy band shaded -->
    <div v-show="showMetricChart" ref="elMetric" class="chart metric"></div>

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

    <section class="no-buys" v-else-if="!loading && !error">
      <p>Tune a driver and <strong>+ Add layer</strong> to build a strategy. Amber rings preview the current driver's buy days.</p>
    </section>

    <p class="hint">
      Build a strategy from one or more seed layers (price ÷ MA, Bollinger score, or
      manual dates). Each buy day gets an equal share of the total budget
      ({{ fmtUSD(totalBudget) }} ÷ {{ strategyIndices.length || '—' }} days). The baseline
      spends the <em>same</em> total evenly across every day of the trailing
      {{ baselineDays }}-day window.
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

.builder {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem;
  margin-bottom: 0.75rem;
  background: var(--bg-elev-2, var(--bg-elev));
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: flex-start;
  margin-bottom: 0.5rem;
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
  width: 12rem;
}
.select.sm {
  width: 9rem;
}
.warn {
  padding: 0.5rem 0.7rem;
  margin-bottom: 0.75rem;
  font-size: 0.78rem;
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid #fbbf24;
  border-radius: var(--radius);
  color: #f6d488;
}
.warn strong {
  color: #fbbf24;
}
.num-input {
  width: 6rem;
}
.num-input.sm {
  width: 4rem;
}
.unit {
  color: var(--text-muted);
  font-size: 0.72rem;
}
.mini {
  font-size: 0.72rem;
  padding: 0.2rem 0.5rem;
}
.mini.ghost {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.add-layer {
  align-self: center;
  font-size: 0.78rem;
  padding: 0.45rem 0.7rem;
  background: rgba(43, 212, 167, 0.14);
  border: 1px solid #2bd4a7;
  color: #2bd4a7;
  border-radius: var(--radius);
  cursor: pointer;
}
.add-layer:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.3rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  color: var(--text);
}
.chip-x {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
}

.layers {
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}
.layers-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.4rem;
}
.muted {
  color: var(--text-muted);
  font-size: 0.74rem;
}
.layer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.layer-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.76rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
}
.layer-kind {
  text-transform: uppercase;
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.35rem;
  border-radius: 0.3rem;
  background: var(--border);
  color: var(--text);
}
.layer-kind.ratio {
  background: rgba(247, 147, 26, 0.2);
  color: #f7931a;
}
.layer-kind.bscore {
  background: rgba(79, 142, 247, 0.2);
  color: #4f8ef7;
}
.layer-kind.manual {
  background: rgba(155, 109, 255, 0.2);
  color: #9b6dff;
}
.layer-label {
  flex: 1;
  color: var(--text);
}
.layer-count {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.chart {
  width: 100%;
  height: min(52vh, 440px);
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
