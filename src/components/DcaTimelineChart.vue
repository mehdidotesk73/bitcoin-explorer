<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { DcaTimelinePoint } from '../lib/indicators'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])

const props = defineProps<{
  dates: string[]
  points: DcaTimelinePoint[]
}>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()
const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'

function buildOption(): echarts.EChartsCoreOption {
  const method = props.points.map((p) => p.methodGrowth)
  const uniform = props.points.map((p) => p.uniformGrowth)
  // "Attractive" = days like today have historically grown more than average
  // (method > uniform). Shade those stretches under the method curve.
  const attractive = props.points.map((p) => (p.methodGrowth >= p.uniformGrowth ? p.methodGrowth : null))

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 52, right: 16, top: 36, bottom: 64 },
    legend: {
      data: ['Days like today', 'Every day'],
      top: 6,
      textStyle: { color: '#e7eaf3' },
      inactiveColor: '#5a6480',
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 27, 42, 0.95)',
      borderColor: '#36425f',
      textStyle: { color: '#e7eaf3' },
      formatter: (ps: any) => {
        const i = ps[0].dataIndex
        const p = props.points[i]
        const verdict = p.ratio >= 1 ? 'attractive' : 'less attractive'
        return (
          `<strong>${props.dates[i]}</strong><br/>` +
          `Days like today: ${p.methodGrowth.toFixed(2)}×<br/>` +
          `Every day: ${p.uniformGrowth.toFixed(2)}×<br/>` +
          `Ratio: ${p.ratio.toFixed(3)}× (${verdict})<br/>` +
          `Coverage: ${(p.coverage * 100).toFixed(1)}%`
        )
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
      type: 'log',
      name: 'trailing growth ×',
      nameTextStyle: { color: AXIS, fontSize: 10 },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, formatter: (v: number) => `${v.toFixed(1)}×` },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, bottom: 12, borderColor: '#36425f', fillerColor: 'rgba(79, 142, 247, 0.18)', textStyle: { color: AXIS } },
    ],
    series: [
      {
        name: 'attractive',
        type: 'line',
        data: attractive,
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(63, 208, 122, 0.18)', origin: 'start' },
        silent: true,
      },
      {
        name: 'Every day',
        type: 'line',
        data: uniform,
        symbol: 'none',
        lineStyle: { color: '#8b94ac', width: 1.2, type: 'dashed' },
      },
      {
        name: 'Days like today',
        type: 'line',
        data: method,
        symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.8 },
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

watch(() => [props.dates, props.points], render)
</script>

<template>
  <div ref="el" class="timeline-chart"></div>
</template>

<style scoped>
.timeline-chart {
  width: 100%;
  height: 240px;
}
</style>
