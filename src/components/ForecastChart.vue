<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
])

const props = defineProps<{
  dates: string[]
  actual: (number | null)[]
  modelMa: number[]
  projected: number[]
  logScale: boolean
  /** ISO date of "today", drawn as a vertical divider. */
  nowDate: string
}>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()

const fmtUSD = (v: number | null) =>
  v == null
    ? '—'
    : '$' +
      v.toLocaleString('en-US', {
        maximumFractionDigits: v < 10 ? 2 : 0,
      })

const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'

function buildOption(): echarts.EChartsCoreOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 64, right: 16, top: 48, bottom: 72 },
    legend: {
      data: ['Actual', 'Value baseline (4yr MA)', 'Projected price'],
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
          `Actual: ${fmtUSD(props.actual[i])}`,
          `Value baseline: ${fmtUSD(props.modelMa[i])}`,
          `Projected: ${fmtUSD(props.projected[i])}`,
        ]
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
      type: props.logScale ? 'log' : 'value',
      scale: true,
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, formatter: (v: number) => fmtUSD(v) },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        start: 0,
        end: 100,
        bottom: 16,
        borderColor: '#36425f',
        fillerColor: 'rgba(79, 142, 247, 0.18)',
        textStyle: { color: AXIS },
      },
    ],
    series: [
      {
        name: 'Value baseline (4yr MA)',
        type: 'line',
        data: props.modelMa,
        symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.5 },
      },
      {
        name: 'Projected price',
        type: 'line',
        data: props.projected,
        symbol: 'none',
        lineStyle: { color: '#9b6dff', width: 1.5, type: 'dashed' },
        markLine: {
          symbol: 'none',
          silent: true,
          label: {
            color: AXIS,
            formatter: 'today',
            position: 'insideEndTop',
          },
          lineStyle: { color: '#5a6480', type: 'dotted' },
          data: [{ xAxis: props.nowDate }],
        },
      },
      {
        name: 'Actual',
        type: 'line',
        data: props.actual,
        symbol: 'none',
        connectNulls: false,
        lineStyle: { color: '#f7931a', width: 1.8 },
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
  resizeObserver.observe(el.value)
})

const resizeObserver = new ResizeObserver(() => chart.value?.resize())

onBeforeUnmount(() => {
  resizeObserver.disconnect()
  chart.value?.dispose()
})

watch(
  () => [props.dates, props.actual, props.modelMa, props.projected, props.logScale],
  render,
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
