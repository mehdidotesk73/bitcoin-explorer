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
import { fmtUSD } from '../lib/format'
import { usePriceSeries } from '../lib/usePriceSeries'
import { useBandScore } from '../lib/useBandScore'
import { AXIS, SPLIT, UP, AMBER, BAND_FILL } from '../lib/chartTheme'
import {
  type Band,
  type SeedKind,
  type SeedLayer,
  ratioSeries,
  selectBandBuyDates,
  simulateStrategy,
  unionIndices,
  snapDateToIndex,
  uniformSpacedDates,
} from '../lib/hodl'
import StatsCompare from './StatsCompare.vue'
import InfoTip from './InfoTip.vue'
import { useChartSync } from '../lib/useChartSync'

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

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
  error: string
  progress: FetchProgress
}>()

const emit = defineEmits<{ refresh: [] }>()

// --- Builder controls -------------------------------------------------------
const driver = ref<SeedKind>('ratio')

// Comparison window: either trailing-X-days-from-today, or an explicit from/to.
const windowMode = ref<'trailing' | 'range'>('trailing')
const baselineDays = ref(3000) // trailing comparison window
const fromDate = ref('')
const toDate = ref('')

// Each indicator driver carries its own buy band [lower, upper].
const ratioLower = ref(0)
const ratioUpper = ref(1.5)
const bLower = ref(-2)
const bUpper = ref(0)

// Uniform-spaced driver: buy every X days on a phase offset from today.
const uniformEveryX = ref(7)
const uniformOffset = ref(0)

// Manual driver: a working list of dates being assembled before "Add layer".
const manualDates = ref<string[]>([])
const manualDateInput = ref('')

// The seed combinator: stored layers, unioned into the final strategy.
const layers = ref<SeedLayer[]>([])

// Total purchase budget in cash; defaults to the current BTC price once known.
const totalBudget = ref(0)
let budgetInitialised = false

// MA window for the price ÷ MA driver (independent of the Price Explorer).
const localMaDays = ref(1460)

// --- Derived data -----------------------------------------------------------
const { prices, dates } = usePriceSeries(() => props.raw)
const longMa = computed(() => sma(prices.value, localMaDays.value))

const maLabel = computed(() => {
  const yr = localMaDays.value / 365
  return yr >= 1 ? `${yr.toFixed(1)}yr` : `${localMaDays.value}d`
})

// Bollinger-score metric — own Period/unit/σ/smoothing + series (independent of
// the Price Explorer's). `series` is the Hodl driver's `bScore`.
const {
  smooth: bandSmooth,
  period: bandPeriod,
  unit: bandUnit,
  k: bandK,
  label: bandLabel,
  smoothLabel: bandSmoothLabel,
  series: bScore,
} = useBandScore(prices)

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
  driver.value === 'bscore' ? bScore.value : ratioSeries(prices.value, longMa.value),
)
const metricTitle = computed(() =>
  driver.value === 'bscore'
    ? `Bollinger score (${bandLabel.value})`
    : `Price ÷ MA (${maLabel.value})`,
)
// Only band-on-a-metric drivers get the shaded driver chart.
const showMetricChart = computed(() => driver.value === 'ratio' || driver.value === 'bscore')

// --- Buy / Hodl indicator ---------------------------------------------------
// For each *currently tuned* pattern, is today's price inside its buy band? If
// so, today reads as a "buy" day for that pattern; otherwise "hodl". This is a
// thin first cut — a future version can pool many macro patterns into a score.
const inBand = (v: number | null, lo: number, hi: number) =>
  v != null && v >= Math.min(lo, hi) && v <= Math.max(lo, hi)

const todayIdx = computed(() => prices.value.length - 1)
const todayDate = computed(() => (todayIdx.value >= 0 ? dates.value[todayIdx.value] : ''))
const todayRatio = computed(() => {
  const m = longMa.value[todayIdx.value]
  return m != null && m > 0 ? prices.value[todayIdx.value] / m : null
})
const todayB = computed(() => (todayIdx.value >= 0 ? bScore.value[todayIdx.value] : null))

const patternSignals = computed(() => [
  {
    id: 'ratio',
    label: `Price ÷ MA (${maLabel.value})`,
    value: todayRatio.value,
    band: { lower: ratioLower.value, upper: ratioUpper.value },
    buy: inBand(todayRatio.value, ratioLower.value, ratioUpper.value),
  },
  {
    id: 'bscore',
    label: 'Bollinger score (b)',
    value: todayB.value,
    band: { lower: bLower.value, upper: bUpper.value },
    buy: inBand(todayB.value, bLower.value, bUpper.value),
  },
])
const buyVotes = computed(() => patternSignals.value.filter((p) => p.buy).length)

// Weekday picker for weekly (every-7) uniform spacing. The grid lands on the
// weekday of (today + offset), so map a chosen weekday back to that offset.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const todayDow = computed(() => {
  const n = dates.value.length
  return n ? new Date(dates.value[n - 1]).getUTCDay() : 0
})
const uniformWeekday = computed<number>({
  get: () => (((todayDow.value + uniformOffset.value) % 7) + 7) % 7,
  set: (w) => {
    uniformOffset.value = (((w - todayDow.value) % 7) + 7) % 7
  },
})

// Manual: resolve the working dates to unique sorted day indices.
const manualPendingIndices = computed(() => {
  const idx = manualDates.value
    .map((d) => snapDateToIndex(dates.value, d))
    .filter((i): i is number => i != null)
  return [...new Set(idx)].sort((a, b) => a - b)
})

// Live preview of what the builder would add as a layer (filtered to the window
// — out-of-window days are excluded from the strategy totals).
const previewIndices = computed(() => {
  if (driver.value === 'manual') return manualPendingIndices.value.filter(inWindow)
  if (driver.value === 'uniform')
    return uniformSpacedDates(
      prices.value.length,
      uniformEveryX.value,
      uniformOffset.value,
      candidates.value,
    )
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
// Live builder preview, scored the same way (current builder vs baseline).
const previewStats = computed(() =>
  simulateStrategy(prices.value, previewIndices.value, totalBudget.value, windowSize.value),
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
    const metric = ratioSeries(prices.value, sma(prices.value, localMaDays.value))
    layers.value.push({
      id: newId(),
      kind: 'ratio',
      label: `Price÷MA ${ratioLower.value}–${ratioUpper.value} · ${maLabel.value}`,
      dateIndices: selectBandBuyDates(metric, builderBand.value, all),
    })
  } else if (driver.value === 'uniform') {
    layers.value.push({
      id: newId(),
      kind: 'uniform',
      label: `Uniform · every ${uniformEveryX.value}d · offset ${uniformOffset.value}`,
      dateIndices: uniformSpacedDates(n, uniformEveryX.value, uniformOffset.value, all),
    })
  } else {
    layers.value.push({
      id: newId(),
      kind: 'bscore',
      label: `b score ${bLower.value}–${bUpper.value} · ${bandLabel.value}`,
      dateIndices: selectBandBuyDates(bScore.value, builderBand.value, all),
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

// --- Price chart ------------------------------------------------------------
const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()

// Shared graphed-range, kept in sync between the price chart and the driver-
// metric chart by an explicit bridge: connect doesn't carry the slider range
// across (the metric chart has no slider to match by index), so we mirror it by
// hand on each chart's `datazoom`. This is the proven setup for these two
// charts; the useChartSync composable below handles only the touch gesture.
const zoom = ref<[number, number]>([0, 100])
let suppressZoom = false
const nearZ = (a: number, b: number) => Math.abs(a - b) < 0.05
function currentRange(c?: echarts.ECharts): [number, number] {
  const dz = (c?.getOption() as any)?.dataZoom?.[0]
  return dz ? [dz.start ?? 0, dz.end ?? 100] : [0, 100]
}
function onZoom(src?: echarts.ECharts) {
  if (suppressZoom || !src) return
  const [s, e] = currentRange(src)
  if (nearZ(s, zoom.value[0]) && nearZ(e, zoom.value[1])) return
  zoom.value = [s, e]
  const other = src === chart.value ? chartMetric.value : chart.value
  if (other) {
    suppressZoom = true
    other.dispatchAction({ type: 'dataZoom', start: s, end: e })
    suppressZoom = false
  }
}

function buildPriceOption(): echarts.EChartsCoreOption {
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
    axisPointer: { lineStyle: { color: '#8b94ac', type: 'dashed' } },
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
      { type: 'inside', start: zoom.value[0], end: zoom.value[1] },
      {
        type: 'slider',
        start: zoom.value[0],
        end: zoom.value[1],
        bottom: 8,
        height: 14,
        borderColor: '#36425f',
        fillerColor: 'rgba(79,142,247,0.18)',
        textStyle: { color: AXIS, fontSize: 9 },
      },
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

// The pan/crosshair touch gesture for each figure. Connect + the zoom/slider
// mirror are handled explicitly in onMounted (above), not by the composable.
const priceGesture = useChartSync({ chart, el })
const metricGesture = useChartSync({ chart: chartMetric, el: elMetric })

function buildMetricOption(): echarts.EChartsCoreOption {
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
    axisPointer: { lineStyle: { color: '#8b94ac', type: 'dashed' } },
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
    dataZoom: [{ type: 'inside', start: zoom.value[0], end: zoom.value[1] }],
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
  echarts.connect(GROUP) // native crosshair/tooltip sync across both figures
  // Mirror the graphed range (incl. the slider) between the two charts by hand.
  chart.value?.on('datazoom', () => onZoom(chart.value))
  chartMetric.value?.on('datazoom', () => onZoom(chartMetric.value))
  priceGesture.attach()
  metricGesture.attach()
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
    localMaDays.value,
    bandSmooth.value,
    bandPeriod.value,
    bandUnit.value,
    bandK.value,
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

    <!-- Buy / Hodl indicator: does today land in each tuned pattern's buy band? -->
    <section class="indicator" v-if="latestPrice">
      <div class="indicator-head">
        <h3>Buy / Hodl indicator <InfoTip term="buyHodlIndicator" /></h3>
        <span class="muted"
          >today {{ todayDate }} · {{ buyVotes }} of {{ patternSignals.length }} patterns say
          buy</span
        >
      </div>
      <div class="signal-row">
        <div class="signal" v-for="p in patternSignals" :key="p.id">
          <span class="signal-label">{{ p.label }}</span>
          <span class="signal-val">
            {{ p.value == null ? '—' : p.value.toFixed(3) }}
            <span class="muted">in [{{ p.band.lower }}, {{ p.band.upper }}]</span>
          </span>
          <span class="verdict" :class="p.value == null ? 'na' : p.buy ? 'buy' : 'hodl'">
            {{ p.value == null ? 'n/a' : p.buy ? 'BUY' : 'HODL' }}
          </span>
        </div>
      </div>
      <p class="indicator-note">
        Reflects the patterns as currently tuned below. A “buy” means today's price sits in that
        pattern's accumulation band; otherwise hodl. Heuristic only — not advice.
      </p>
    </section>

    <!-- Builder -->
    <section class="builder">
      <p class="driver-note">
        Drivers are <strong>tunable, pattern-based price pickers</strong> — they flag historical
        days matching a rule you set. Bitcoin is <strong>not guaranteed</strong>
        to repeat its past or present patterns in the future; treat results as exploration, not
        prediction.
      </p>
      <div class="controls">
        <label class="ctrl-label">
          <span>Driver <InfoTip term="driver" /></span>
          <select v-model="driver" class="select">
            <option value="ratio">Price ÷ MA</option>
            <option value="bscore">Bollinger score (b)</option>
            <option value="uniform">Uniform spaced</option>
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
          <span>Buy band (price ÷ MA) <InfoTip term="buyBand" /></span>
          <span class="ctrl-row">
            <input
              type="number"
              v-model.number="ratioLower"
              min="0"
              max="3"
              step="0.01"
              class="num-input sm"
            />
            <span class="unit">to</span>
            <input
              type="number"
              v-model.number="ratioUpper"
              min="0"
              max="3"
              step="0.01"
              class="num-input sm"
            />
          </span>
        </label>
        <div class="ctrl-label" v-if="driver === 'bscore'">
          Bollinger score
          <label class="param">
            Period
            <span class="ctrl-row">
              <input
                type="number"
                v-model.number="bandPeriod"
                min="2"
                max="3000"
                class="num-input"
              />
              <select v-model="bandUnit" class="param-sel">
                <option value="day">days</option>
                <option value="week">weeks</option>
                <option value="month">months</option>
              </select>
            </span>
          </label>
          <label class="param">
            σ ×
            <input
              type="number"
              v-model.number="bandK"
              min="0.5"
              max="5"
              step="0.5"
              class="num-input"
            />
          </label>
          <label class="param">
            Smoothing
            <span class="ctrl-row">
              <input
                type="number"
                v-model.number="bandSmooth"
                min="0"
                max="365"
                step="1"
                class="num-input"
              />
              <span class="unit">{{ bandSmoothLabel }}</span>
            </span>
          </label>
        </div>
        <label class="ctrl-label" v-if="driver === 'bscore'">
          <span>Buy band (b score) <InfoTip term="buyBand" /></span>
          <span class="ctrl-row">
            <input
              type="number"
              v-model.number="bLower"
              min="-8"
              max="8"
              step="0.1"
              class="num-input sm"
            />
            <span class="unit">to</span>
            <input
              type="number"
              v-model.number="bUpper"
              min="-8"
              max="8"
              step="0.1"
              class="num-input sm"
            />
          </span>
        </label>
        <label class="ctrl-label" v-if="driver === 'uniform'">
          Every X days · {{ uniformEveryX === 7 ? 'weekday' : 'offset' }}
          <span class="ctrl-row">
            <input
              type="number"
              v-model.number="uniformEveryX"
              min="1"
              max="365"
              step="1"
              class="num-input sm"
            />
            <span class="unit">days</span>
            <select v-if="uniformEveryX === 7" v-model.number="uniformWeekday" class="select sm">
              <option v-for="(w, i) in WEEKDAYS" :key="i" :value="i">{{ w }}</option>
            </select>
            <template v-else>
              <input
                type="number"
                v-model.number="uniformOffset"
                min="0"
                max="365"
                step="1"
                class="num-input sm"
              />
              <span class="unit">offset</span>
            </template>
          </span>
        </label>
        <div class="ctrl-label" v-else-if="driver === 'manual'">
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
          <span class="muted"
            >Seed layers — combined into the strategy ({{ strategyIndices.length }} unique
            days):</span
          >
          <button class="mini ghost" @click="clearLayers">Clear all</button>
        </div>
        <ul class="layer-list">
          <li v-for="l in layers" :key="l.id" class="layer-item">
            <span class="layer-kind" :class="l.kind">{{ l.kind }}</span>
            <span class="layer-label">{{ l.label }}</span>
            <span class="layer-count">
              {{ layerActive(l)
              }}<template v-if="layerTotal(l) !== layerActive(l)"> of {{ layerTotal(l) }}</template>
              days
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
      ℹ️ {{ outOfWindowDates.length }} manual date(s) sit outside the comparison window and are
      ignored in the totals (still stored): <strong>{{ outOfWindowDates.join(', ') }}</strong
      >. Widen the window to include them.
    </section>

    <!-- Budget + window -->
    <section class="controls">
      <label class="ctrl-label">
        <span>Total budget <InfoTip term="totalBudget" /></span>
        <span class="ctrl-row">
          <span class="unit">$</span>
          <input type="number" v-model.number="totalBudget" min="1" step="100" class="num-input" />
        </span>
      </label>

      <!-- Window panel: a toggle flips the input between trailing-days and a
           from/to date range. -->
      <div class="ctrl-label window-panel">
        <div class="window-head">
          <span>Comparison window <InfoTip term="comparisonWindow" /></span>
          <button
            class="toggle"
            @click="windowMode = windowMode === 'trailing' ? 'range' : 'trailing'"
          >
            {{ windowMode === 'trailing' ? 'Trailing' : 'Range' }}
          </button>
        </div>
        <span v-if="windowMode === 'trailing'" class="ctrl-row">
          <input
            type="number"
            v-model.number="baselineDays"
            min="30"
            max="6000"
            step="30"
            class="num-input"
          />
          <span class="unit">days back from today</span>
        </span>
        <span v-else class="ctrl-row">
          <input
            type="date"
            v-model="fromDate"
            :min="dates[0]"
            :max="dates[dates.length - 1]"
            class="num-input"
          />
          <span class="unit">→</span>
          <input
            type="date"
            v-model="toDate"
            :min="dates[0]"
            :max="dates[dates.length - 1]"
            class="num-input"
          />
        </span>
      </div>
    </section>

    <!-- Price chart with buy markers -->
    <div ref="el" class="chart"></div>

    <!-- Driver-metric chart with the buy band shaded -->
    <div v-show="showMetricChart" ref="elMetric" class="chart metric"></div>

    <!-- Strategy (saved layers) vs baseline -->
    <template v-if="strategyStats && baselineStats">
      <h4 class="stats-head">Strategy vs baseline · saved layers</h4>
      <StatsCompare
        label="Strategy"
        label-class="strategy"
        :sub="`${strategyStats.numBuys} buys · ${(strategyStats.coverage * 100).toFixed(1)}% of window`"
        :primary="strategyStats"
        :baseline="baselineStats"
        :baseline-sub="`Every day · ${windowSize} days`"
      />
    </template>
    <section class="no-buys" v-else-if="!loading && !error">
      <p>
        Tune a driver and <strong>+ Add layer</strong> to build a strategy. Amber rings preview the
        current driver's buy days.
      </p>
    </section>

    <!-- Preview (live builder) vs baseline -->
    <template v-if="previewStats && baselineStats">
      <h4 class="stats-head">Preview vs baseline · current builder (not yet added)</h4>
      <StatsCompare
        label="Preview"
        label-class="preview"
        :sub="`${previewStats.numBuys} buys · ${(previewStats.coverage * 100).toFixed(1)}% of window`"
        :primary="previewStats"
        :baseline="baselineStats"
        :baseline-sub="`Every day · ${windowSize} days`"
      />
    </template>

    <p class="hint">
      Build a strategy from one or more seed layers (price ÷ MA, Bollinger score, uniform spacing,
      or manual dates). Each buy day gets an equal share of the total budget ({{
        fmtUSD(totalBudget)
      }}
      ÷ {{ strategyIndices.length || '—' }} days). The baseline spends the <em>same</em> total
      evenly across every day of the comparison window.
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

.indicator {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.75rem;
  background: var(--bg-elev);
}
.indicator-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.indicator-head h3 {
  margin: 0;
  font-size: 0.95rem;
}
.signal-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.5rem 0 0.4rem;
}
.signal {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 14rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.35rem 0.55rem;
  background: var(--bg-elev-2, var(--bg-elev));
}
.signal-label {
  font-size: 0.78rem;
  color: var(--text);
}
.signal-val {
  margin-left: auto;
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.verdict {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.45rem;
  border-radius: 0.3rem;
}
.verdict.buy {
  background: rgba(43, 212, 167, 0.2);
  color: #2bd4a7;
}
.verdict.hodl {
  background: rgba(155, 109, 255, 0.18);
  color: #9b6dff;
}
.verdict.na {
  background: var(--border);
  color: var(--text-muted);
}
.indicator-note {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.driver-note {
  margin: 0 0 0.6rem;
  font-size: 0.74rem;
  color: var(--text-muted);
  line-height: 1.45;
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
/* Vertically-stacked parameter rows inside a card (matches the Price Explorer). */
.param {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.param .num-input {
  width: 4rem;
}
.param-sel {
  width: auto;
}
.select {
  width: 12rem;
}
.select.sm {
  width: 9rem;
}
.window-panel {
  gap: 0.35rem;
}
.window-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.toggle {
  font-size: 0.66rem;
  padding: 0.12rem 0.5rem;
  border: 1px solid var(--accent-blue, #4f8ef7);
  background: rgba(79, 142, 247, 0.12);
  color: var(--accent-blue, #4f8ef7);
  border-radius: 1rem;
  cursor: pointer;
}
.stats-head {
  margin: 0.75rem 0 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
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
.layer-kind.uniform {
  background: rgba(43, 212, 167, 0.2);
  color: #2bd4a7;
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
