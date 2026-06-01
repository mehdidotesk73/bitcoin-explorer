<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { logDebug } from '../debug'

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
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

// Map a signed heat value in [-1, +1] to a diverging colour: -1 hot red …
// 0 neutral grey … +1 cool blue. Used for per-point line colouring (more
// robust than a visualMap, which needs series dimension tracking).
function heatColor(h: number): string {
  const t = Math.max(-1, Math.min(1, h))
  // Vivid endpoints with a pale midpoint so even small heat departs visibly
  // from neutral; a sqrt ramp makes mid-range values saturate quickly.
  const mid = [225, 230, 240] // near-white neutral
  const end =
    t >= 0
      ? [0, 122, 255] // cool: bright blue
      : [255, 45, 45] // hot: bright red
  const f = Math.sqrt(Math.abs(t))
  const mix = (i: number) => Math.round(mid[i] + (end[i] - mid[i]) * f)
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`
}

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

  // When heat tinting is on, overlay one coloured dot per sample on top of a
  // faint neutral price line. Per-point itemStyle on a scatter series reliably
  // honours colour (unlike line-segment lineStyle / visualMap on a category
  // axis here), so this is the robust way to tint by heat.
  const heatOn = !!props.showHeat && !!props.heat && props.heat.length === props.price.length
  const heatPoints = heatOn
    ? props.price.map((v, i) => ({
        value: [i, v],
        itemStyle: { color: heatColor(props.heat![i]) },
      }))
    : []

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
        data: props.price,
        symbol: 'none',
        // When heat is on, the line is a faint neutral guide and the colour is
        // carried by the heat-dot series below (per-point itemStyle always
        // honours colour, unlike line-segment lineStyle / visualMap here).
        lineStyle: heatOn
          ? { color: 'rgba(160,170,190,0.2)', width: 1 }
          : { color: '#f7931a', width: 1.5 },
      },
      // Heat overlay: one coloured dot per sample, tinted by the heat score.
      ...(heatOn
        ? [
            {
              name: '__heat',
              type: 'scatter' as const,
              data: heatPoints,
              symbolSize: 5,
              silent: true,
            },
          ]
        : []),
    ],
  }
}

function render() {
  chart.value?.setOption(buildOption(), { replaceMerge: ['series'] })
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
  // confirm the per-point colours made it onto the Price series data.
  try {
    const heatOn = !!props.showHeat && !!props.heat && props.heat.length === props.price.length
    const opt = chart.value.getOption() as any
    const heatSeries = (opt?.series ?? []).find((s: any) => s.name === '__heat')
    const d0 = heatSeries?.data?.[heatSeries.data.length - 1]
    logDebug(
      `chart: heatOn=${heatOn} series=${opt?.series?.length} ` +
        `heatPts=${heatSeries?.data?.length ?? 0} ` +
        `lastColor=${d0?.itemStyle?.color ?? 'none'}`,
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
