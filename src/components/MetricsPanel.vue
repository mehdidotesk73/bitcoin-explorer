<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { MwHeatResult, Horizon } from '../lib/mwheat'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent, CanvasRenderer])

// Shared connect group: all explorer charts sync x-zoom + crosshair through it.
const GROUP = 'btc-explorer'
const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'
const UP_RUN = 'rgba(43, 212, 167, 0.16)' // sustained up-run shading
const DOWN_RUN = 'rgba(247, 75, 75, 0.14)' // sustained down-run shading

const props = defineProps<{
  dates: string[]
  price: number[]
  ma: (number | null)[]
  result: MwHeatResult
  /** Graphed-range window [startPercent, endPercent] synced across the tab. */
  zoom: [number, number]
}>()
const emit = defineEmits<{ 'update:zoom': [value: [number, number]] }>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()
let suppressZoomEvent = false
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

// b / runs come from one horizon; price ÷ MA uses the chart's own MA.
const horizon = ref<Horizon>('weekly')
const available = computed(() => props.result.horizons.map((h) => h.horizon))
const diag = computed(
  () => props.result.horizons.find((h) => h.horizon === horizon.value) ?? props.result.horizons[0],
)
const priceMa = computed(() =>
  props.price.map((p, i) => {
    const m = props.ma[i]
    return m != null && m > 0 ? p / m : null
  }),
)

function buildOption(): echarts.EChartsCoreOption {
  const d = diag.value
  if (!d) return {}
  const cats = props.dates
  const runArea = {
    silent: true,
    data: d.runs.map((r) => [
      { xAxis: cats[r.start], itemStyle: { color: r.dir > 0 ? UP_RUN : DOWN_RUN } },
      { xAxis: cats[r.end] },
    ]),
  }
  const S = [6, 172] // header top of each panel (px)
  const GRID = (i: number) => ({ left: 48, right: 12, top: S[i] + 40, height: 108 })
  const titleBase = { left: 48, textStyle: { color: '#cdd3e4', fontSize: 11, fontWeight: 'normal' as const } }
  const legendBase = { type: 'plain' as const, itemWidth: 13, itemHeight: 8, itemGap: 8, textStyle: { color: '#e7eaf3', fontSize: 9 }, inactiveColor: '#5a6480' }

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(20,27,42,0.95)', borderColor: '#36425f', textStyle: { color: '#e7eaf3' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#8b94ac', type: 'dashed' } },
    title: [
      { ...titleBase, top: S[0], text: 'Price ÷ MA    > 1 = above the moving average · < 1 = below (oversold)' },
      { ...titleBase, top: S[1], text: `b = band position · shaded by run (green up · red down · gaps = chop)   (${d.horizon})` },
    ],
    legend: [
      { ...legendBase, left: 48, top: S[0] + 20, data: ['price ÷ MA'] },
      { ...legendBase, left: 48, top: S[1] + 20, data: ['b'] },
    ],
    grid: [GRID(0), GRID(1)],
    xAxis: [
      { type: 'category', data: cats, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: AXIS } } },
      { type: 'category', data: cats, gridIndex: 1, axisLabel: { color: AXIS, fontSize: 9 }, axisLine: { lineStyle: { color: AXIS } } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, scale: true, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', gridIndex: 1, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: props.zoom[0], end: props.zoom[1] },
      { type: 'slider', xAxisIndex: [0, 1], start: props.zoom[0], end: props.zoom[1], bottom: 4, height: 12, borderColor: '#36425f', fillerColor: 'rgba(79,142,247,0.18)', textStyle: { color: AXIS, fontSize: 9 } },
    ],
    series: [
      {
        name: 'price ÷ MA', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: priceMa.value, symbol: 'none',
        lineStyle: { color: '#f7931a', width: 1.4 },
        markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#5a6480', type: 'dashed' }, data: [{ yAxis: 1 }] },
      },
      {
        name: 'b', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.b, symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.5 },
        markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#5a6480', type: 'dashed' }, data: [{ yAxis: 0 }, { yAxis: 1 }, { yAxis: -1 }] },
        markArea: runArea,
      },
    ],
  }
}

function render() {
  suppressZoomEvent = true
  chart.value?.setOption(buildOption(), { replaceMerge: ['series'] })
  suppressZoomEvent = false
}

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  chart.value.group = GROUP
  render()
  echarts.connect(GROUP)
  chart.value.on('datazoom', () => {
    if (suppressZoomEvent) return
    const opt = chart.value?.getOption() as any
    const dz = opt?.dataZoom?.[0]
    if (!dz) return
    const start = dz.start ?? 0
    const end = dz.end ?? 100
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
watch(() => [props.dates, props.price, props.ma, props.result, horizon.value, props.zoom], render)
</script>

<template>
  <div class="metrics">
    <div class="metrics-controls">
      <span class="muted">Metrics — b / runs horizon:</span>
      <button
        v-for="h in available"
        :key="h"
        :class="{ active: horizon === h }"
        @click="horizon = h"
      >
        {{ h }}
      </button>
    </div>
    <div ref="el" class="metrics-chart"></div>
  </div>
</template>

<style scoped>
.metrics {
  margin-top: 0.5rem;
}
.metrics-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
  flex-wrap: wrap;
}
.metrics-controls button {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  text-transform: capitalize;
}
.metrics-controls button.active {
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}
.metrics-chart {
  width: 100%;
  height: 340px;
}
.muted {
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
