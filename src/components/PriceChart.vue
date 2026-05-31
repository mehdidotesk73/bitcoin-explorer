<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
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

  return {
    animation: false,
    grid: { left: 56, right: 16, top: 48, bottom: 72 },
    legend: {
      data: ['Price', `MA (${props.maLabel})`, `Bollinger (${props.bbLabel})`],
      top: 8,
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const i = params[0].dataIndex
        const rows = [
          `<strong>${props.dates[i]}</strong>`,
          `Price: ${fmtUSD(props.price[i])}`,
          `MA (${props.maLabel}): ${fmtUSD(props.ma[i])}`,
          `Upper: ${fmtUSD(props.upper[i])}`,
          `Lower: ${fmtUSD(props.lower[i])}`,
        ]
        return rows.join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      data: props.dates,
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { formatter: (v: number) => fmtUSD(v) },
    },
    dataZoom: [
      { type: 'inside', start: props.zoom[0], end: props.zoom[1] },
      { type: 'slider', start: props.zoom[0], end: props.zoom[1], bottom: 16 },
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
        areaStyle: { color: 'rgba(66, 184, 131, 0.18)' },
      },
      {
        name: `MA (${props.maLabel})`,
        type: 'line',
        data: props.ma,
        symbol: 'none',
        lineStyle: { color: '#f0a020', width: 1.5 },
      },
      {
        name: 'Price',
        type: 'line',
        data: props.price,
        symbol: 'none',
        lineStyle: { color: '#42b883', width: 1.5 },
      },
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
  () => [props.dates, props.price, props.ma, props.upper, props.lower],
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
