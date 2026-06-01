<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { logDebug } from '../debug'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  CanvasRenderer,
])

const props = defineProps<{
  dates: string[]
  price: number[]
  ma: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
  maLabel: string
  bbLabel: string
  /** Signed M/W heat per sample in [-1, +1] (+cool W … -hot M). */
  heat?: number[]
  /** Tint the price line by `heat` when true. */
  showHeat?: boolean
  /** Graphed-range window as [startPercent, endPercent], 0–100. */
  zoom: [number, number]
}>()

const emit = defineEmits<{ 'update:zoom': [value: [number, number]] }>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()

const fmtUSD = (v: number | null) =>
  v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })

function buildOption(): echarts.EChartsCoreOption {
  // The shaded band is drawn with two stacked series: an invisible baseline at
  // the lower band, plus the band thickness (upper − lower) rendered as an area.
  const bandBase = props.lower
  const bandSpan = props.upper.map((u, i) => {
    const l = props.lower[i]
    return u == null || l == null ? null : u - l
  })

  const AXIS = '#8b94ac'
  const SPLIT = 'rgba(54, 66, 95, 0.45)'

  // When heat tinting is on, give the Price series a 3rd "heat" dimension and
  // colour it with a continuous visualMap: +1 cool (W) … 0 neutral … -1 hot (M).
  const heatOn = !!props.showHeat && !!props.heat && props.heat.length === props.price.length
  const priceSeriesIndex = 5 // position of the Price series in the array below
  const priceData = heatOn
    ? props.price.map((v, i) => [i, v, props.heat![i]])
    : props.price

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 56, right: 16, top: 48, bottom: 72 },
    legend: {
      data: ['Price', `MA (${props.maLabel})`, `Bollinger (${props.bbLabel})`],
      top: 8,
      textStyle: { color: '#e7eaf3' },
      inactiveColor: '#5a6480',
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 27, 42, 0.95)',
      borderColor: '#36425f',
      textStyle: { color: '#e7eaf3' },
      formatter: (params: any) => {
        const i = params[0].dataIndex
        const rows = [
          `<strong>${props.dates[i]}</strong>`,
          `Price: ${fmtUSD(props.price[i])}`,
          `MA (${props.maLabel}): ${fmtUSD(props.ma[i])}`,
          `Upper: ${fmtUSD(props.upper[i])}`,
          `Lower: ${fmtUSD(props.lower[i])}`,
        ]
        if (props.showHeat && props.heat && props.heat[i] != null) {
          const h = props.heat[i]
          const label = h > 0.05 ? 'cool / W' : h < -0.05 ? 'hot / M' : 'neutral'
          rows.push(`M/W heat: ${h.toFixed(2)} (${label})`)
        }
        return rows.join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      data: props.dates,
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
      { type: 'inside', start: props.zoom[0], end: props.zoom[1] },
      {
        type: 'slider',
        start: props.zoom[0],
        end: props.zoom[1],
        bottom: 16,
        borderColor: '#36425f',
        fillerColor: 'rgba(79, 142, 247, 0.18)',
        textStyle: { color: AXIS },
      },
    ],
    series: [
      // --- Bollinger band fill (drawn first, under everything) ---
      {
        name: '__bb_base',
        type: 'line',
        data: bandBase,
        stack: 'bb',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        silent: true,
      },
      {
        name: `Bollinger (${props.bbLabel})`,
        type: 'line',
        data: bandSpan,
        stack: 'bb',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(155, 109, 255, 0.16)' },
      },
      // --- Bollinger band boundary lines ---
      {
        name: '__bb_upper',
        type: 'line',
        data: props.upper,
        symbol: 'none',
        lineStyle: { color: 'rgba(155, 109, 255, 0.55)', width: 1, type: 'dashed' },
        silent: true,
      },
      {
        name: '__bb_lower',
        type: 'line',
        data: props.lower,
        symbol: 'none',
        lineStyle: { color: 'rgba(155, 109, 255, 0.55)', width: 1, type: 'dashed' },
        silent: true,
      },
      {
        name: `MA (${props.maLabel})`,
        type: 'line',
        data: props.ma,
        symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.5 },
      },
      {
        name: 'Price',
        type: 'line',
        data: priceData,
        symbol: 'none',
        // On a category axis a line series only tracks 2 data dims by default,
        // so visualMap.dimension:2 reads nothing. Declaring 3 dimensions exposes
        // the heat dim (2) for the visualMap to colour by.
        ...(heatOn
          ? { dimensions: ['idx', 'price', 'heat'], encode: { x: 0, y: 1 } }
          : {}),
        // Omit an explicit colour when heat is on so the visualMap drives it
        // (an explicit lineStyle.color overrides the visualMap mapping).
        lineStyle: heatOn ? { width: 2 } : { color: '#f7931a', width: 1.5 },
      },
    ],
    visualMap: heatOn
      ? {
          show: false,
          type: 'continuous',
          seriesIndex: priceSeriesIndex,
          dimension: 2,
          min: -1,
          max: 1,
          // Diverging scale: -1 (hot/M) deep red … 0 neutral grey … +1 (cool/W)
          // deep blue. A grey midpoint (not amber) makes any tint clearly read
          // as "heat" rather than the plain orange price line.
          inRange: {
            color: ['#e23b3b', '#e88f5a', '#9aa3b8', '#5aa9e8', '#2f6fe0'],
          },
        }
      : undefined,
  }
}

function render() {
  // replaceMerge visualMap too, so toggling heat off fully removes the mapping.
  chart.value?.setOption(buildOption(), { replaceMerge: ['series', 'visualMap'] })
}

// Guards against an infinite loop between the chart's `datazoom` event and the
// prop-driven `dispatchAction` below: each can otherwise re-trigger the other.
let suppressZoomEvent = false
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

function currentZoom(): [number, number] {
  const opt = chart.value?.getOption() as any
  const dz = opt?.dataZoom?.[0]
  return dz ? [dz.start ?? 0, dz.end ?? 100] : [0, 100]
}

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  render()
  // One-shot diagnostic (runs once, fully guarded — cannot loop or throw):
  // report whether the visualMap actually landed in the live chart option.
  try {
    const heatOn = !!props.showHeat && !!props.heat && props.heat.length === props.price.length
    const opt = chart.value.getOption() as any
    const vm = opt?.visualMap
    const sample = (props.heat ?? []).slice(-3).map((v) => v.toFixed(2)).join(',')
    logDebug(
      `chart: heatOn=${heatOn} visualMaps=${vm ? vm.length : 0} ` +
        `dim=${vm?.[0]?.dimension} seriesIdx=${vm?.[0]?.seriesIndex} ` +
        `series=${opt?.series?.length} lastHeat=[${sample}]`,
    )
  } catch (e) {
    logDebug(`chart diag failed: ${e}`, 'error')
  }
  // Keep the parent's zoom model in sync when the user drags/pinches, but only
  // emit when the value actually changed (and not while we're applying one).
  chart.value.on('datazoom', () => {
    if (suppressZoomEvent) return
    const [start, end] = currentZoom()
    if (near(start, props.zoom[0]) && near(end, props.zoom[1])) return
    emit('update:zoom', [start, end])
  })
  resizeObserver.observe(el.value)
})

const resizeObserver = new ResizeObserver(() => chart.value?.resize())

onBeforeUnmount(() => {
  resizeObserver.disconnect()
  chart.value?.dispose()
})

// Re-render when data or indicator parameters change.
watch(
  () => [props.dates, props.price, props.ma, props.upper, props.lower, props.heat, props.showHeat],
  render,
)

// Apply externally-driven zoom changes (preset range buttons) to the chart.
// Skip if the chart is already there, and suppress the resulting event so it
// doesn't echo back as another parent update.
watch(
  () => props.zoom,
  ([start, end]) => {
    const [cs, ce] = currentZoom()
    if (near(cs, start) && near(ce, end)) return
    suppressZoomEvent = true
    chart.value?.dispatchAction({ type: 'dataZoom', start, end })
    suppressZoomEvent = false
  },
)
</script>

<template>
  <div ref="el" class="chart"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: min(64vh, 560px);
}
</style>
