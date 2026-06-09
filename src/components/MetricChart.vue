<script setup lang="ts">
// One separate-curve figure = one single-grid ECharts instance, joined into the
// shared `btc-explorer` connect group. Mirrors the Hodl Explorer's structure so
// the native crosshair/tooltip and zoom sync smoothly across every figure — the
// parent (MetricsPanel) just hands each instance its pre-built series.
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { AXIS, SPLIT } from '../lib/chartTheme'
import { useChartSync, EXPLORER_GROUP } from '../lib/useChartSync'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent, CanvasRenderer])

const props = defineProps<{
  dates: string[]
  title: string
  yType: 'value' | 'log'
  /** Fully-built ECharts series for this single grid (xAxisIndex/yAxisIndex 0). */
  series: any[]
  legendData: string[]
  zoom: [number, number]
}>()
const emit = defineEmits<{ 'update:zoom': [value: [number, number]] }>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()

function buildOption(): echarts.EChartsCoreOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 52, right: 12, top: 40, bottom: 26 },
    title: { left: 52, top: 6, text: props.title, textStyle: { color: '#cdd3e4', fontSize: 11, fontWeight: 'normal' } },
    legend: { type: 'plain', left: 52, top: 22, itemWidth: 13, itemHeight: 8, itemGap: 8, data: props.legendData, textStyle: { color: '#e7eaf3', fontSize: 9 }, inactiveColor: '#5a6480' },
    axisPointer: { lineStyle: { color: '#8b94ac', type: 'dashed' } },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(20,27,42,0.95)', borderColor: '#36425f', textStyle: { color: '#e7eaf3' } },
    xAxis: {
      type: 'category',
      data: props.dates,
      axisLabel: { color: AXIS, fontSize: 9 },
      axisLine: { lineStyle: { color: AXIS } },
    },
    yAxis: {
      type: props.yType,
      axisLabel: { color: AXIS, fontSize: 9 },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    dataZoom: [{ type: 'inside', start: props.zoom[0], end: props.zoom[1] }],
    series: props.series,
  }
}

function render() {
  chart.value?.setOption(buildOption(), { replaceMerge: ['series'] })
}

const { attach } = useChartSync({
  chart,
  el,
  group: EXPLORER_GROUP,
  getZoom: () => props.zoom,
  onZoom: (z) => emit('update:zoom', z),
})

const resizeObserver = new ResizeObserver(() => chart.value?.resize())

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  render()
  attach()
  resizeObserver.observe(el.value)
})
onBeforeUnmount(() => {
  resizeObserver.disconnect()
  chart.value?.dispose()
})

watch(() => [props.dates, props.series, props.title, props.yType], render)
</script>

<template>
  <div ref="el" class="metric-chart"></div>
</template>

<style scoped>
.metric-chart {
  width: 100%;
  height: 168px;
  margin-top: 0.5rem;
}
</style>
