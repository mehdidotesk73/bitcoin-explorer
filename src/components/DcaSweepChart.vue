<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { DcaSweepPoint } from '../lib/indicators'

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer])

const props = defineProps<{
  points: DcaSweepPoint[]
  /** Current band centre, drawn as a marker so the slider position is visible. */
  center: number
}>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()
const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'

function buildOption(): echarts.EChartsCoreOption {
  // Plot the score vs uniform DCA; 1.0 = parity.
  const ratio = props.points.map((p) => [p.center, p.score])
  const coverage = props.points.map((p) => [p.center, p.coverage])
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 52, right: 44, top: 24, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 27, 42, 0.95)',
      borderColor: '#36425f',
      textStyle: { color: '#e7eaf3' },
      formatter: (ps: any) => {
        const c = ps[0].data[0]
        const p = props.points.find((q) => Math.abs(q.center - c) < 1e-6)
        if (!p) return ''
        return (
          `centre ${p.center.toFixed(2)}<br/>` +
          `score vs uniform: <strong>${p.score.toFixed(3)}×</strong><br/>` +
          `coverage: ${(p.coverage * 100).toFixed(1)}%`
        )
      },
    },
    xAxis: {
      type: 'value',
      min: -1,
      max: 1,
      name: 'band centre  (−hot/M … +cool/W)',
      nameLocation: 'middle',
      nameGap: 22,
      nameTextStyle: { color: AXIS, fontSize: 10 },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '× vs every-day',
        nameTextStyle: { color: AXIS, fontSize: 10 },
        axisLine: { lineStyle: { color: AXIS } },
        axisLabel: { color: AXIS, formatter: (v: number) => `${v.toFixed(1)}×` },
        splitLine: { lineStyle: { color: SPLIT } },
      },
      {
        type: 'value',
        min: 0,
        max: 1,
        position: 'right',
        axisLine: { lineStyle: { color: '#5a6480' } },
        axisLabel: { color: '#5a6480', formatter: (v: number) => `${(v * 100) | 0}%` },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'coverage',
        type: 'line',
        yAxisIndex: 1,
        data: coverage,
        symbol: 'none',
        lineStyle: { color: 'rgba(90,100,128,0.7)', width: 1, type: 'dashed' },
        areaStyle: { color: 'rgba(90,100,128,0.10)' },
      },
      {
        name: 'ratio',
        type: 'line',
        data: ratio,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 2 },
        // Parity line (1.0) + the current band-centre marker.
        markLine: {
          symbol: 'none',
          silent: true,
          label: { color: AXIS, fontSize: 10 },
          lineStyle: { color: '#5a6480', type: 'dotted' },
          data: [
            { yAxis: 1, label: { formatter: 'parity' } },
            {
              xAxis: props.center,
              lineStyle: { color: '#9b6dff', type: 'solid' },
              label: { formatter: 'centre', color: '#9b6dff' },
            },
          ],
        },
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

watch(() => [props.points, props.center], render)
</script>

<template>
  <div ref="el" class="sweep-chart"></div>
</template>

<style scoped>
.sweep-chart {
  width: 100%;
  height: 220px;
}
</style>
