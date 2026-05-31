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
  maPeriod: number
  bbPeriod: number
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
      data: ['Price', `MA (${props.maPeriod})`, `Bollinger (${props.bbPeriod})`],
      top: 8,
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const i = params[0].dataIndex
        const rows = [
          `<strong>${props.dates[i]}</strong>`,
          `Price: ${fmtUSD(props.price[i])}`,
          `MA (${props.maPeriod}): ${fmtUSD(props.ma[i])}`,
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
        name: `Bollinger (${props.bbPeriod})`,
        type: 'line',
        data: bandSpan,
        stack: 'bb',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(66, 184, 131, 0.18)' },
      },
      {
        name: `MA (${props.maPeriod})`,
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

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  render()
  // Keep the parent's zoom model in sync when the user drags/pinches.
  chart.value.on('datazoom', () => {
    const opt = chart.value!.getOption() as any
    const dz = opt.dataZoom?.[0]
    if (dz) emit('update:zoom', [dz.start, dz.end])
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
watch(
  () => props.zoom,
  ([start, end]) => {
    chart.value?.dispatchAction({ type: 'dataZoom', start, end })
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
