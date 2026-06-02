<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { MwHeatResult, Horizon } from '../lib/mwheat'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer])

const UP_RUN = 'rgba(43, 212, 167, 0.16)' // sustained up-run shading
const DOWN_RUN = 'rgba(247, 75, 75, 0.14)' // sustained down-run shading

const props = defineProps<{
  dates: string[]
  result: MwHeatResult
  /** Graphed-range window [startPercent, endPercent] synced from the price chart. */
  zoom: [number, number]
}>()

const emit = defineEmits<{ 'update:zoom': [value: [number, number]] }>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()
const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'

// Guard against the datazoom-event ↔ prop-driven render feedback loop.
let suppressZoomEvent = false
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

// Which horizon's internals (b, τ, vote) to inspect.
const horizon = ref<Horizon>('weekly')
const available = computed(() => props.result.horizons.map((h) => h.horizon))
const diag = computed(
  () => props.result.horizons.find((h) => h.horizon === horizon.value) ?? props.result.horizons[0],
)

function buildOption(): echarts.EChartsCoreOption {
  const d = diag.value
  if (!d) return {}
  const cats = props.dates
  // Panel 1: b-space for the selected horizon (0 = MA, ±1 = bands).
  // Panel 2: τ and vote for the selected horizon (−1..1).
  // Panel 3: per-horizon heat + composite (−1..1).
  // Shade panel 1 by sustainment run: green = up-run, red = down-run, gaps = chop.
  const runArea = {
    silent: true,
    data: d.runs.map((r) => [
      { xAxis: cats[r.start], itemStyle: { color: r.dir > 0 ? UP_RUN : DOWN_RUN } },
      { xAxis: cats[r.end] },
    ]),
  }

  const perHeat = props.result.horizons.map((hz) => ({
    name: `${hz.horizon} H`,
    type: 'line' as const,
    xAxisIndex: 2,
    yAxisIndex: 2,
    data: hz.heat,
    symbol: 'none',
    lineStyle: { width: hz.horizon === horizon.value ? 1.8 : 1, opacity: hz.horizon === horizon.value ? 1 : 0.5 },
  }))

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    legend: { top: 4, textStyle: { color: '#e7eaf3', fontSize: 10 }, inactiveColor: '#5a6480' },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(20,27,42,0.95)', borderColor: '#36425f', textStyle: { color: '#e7eaf3' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 48, right: 12, top: 36, height: '24%' },
      { left: 48, right: 12, top: '42%', height: '22%' },
      { left: 48, right: 12, top: '70%', height: '22%' },
    ],
    xAxis: [
      { type: 'category', data: cats, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: AXIS } } },
      { type: 'category', data: cats, gridIndex: 1, axisLabel: { show: false }, axisLine: { lineStyle: { color: AXIS } } },
      { type: 'category', data: cats, gridIndex: 2, axisLabel: { color: AXIS, fontSize: 9 }, axisLine: { lineStyle: { color: AXIS } } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, name: `b (${d.horizon})`, nameTextStyle: { color: AXIS, fontSize: 10 }, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', gridIndex: 1, min: -1, max: 1, name: 'τ / vote', nameTextStyle: { color: AXIS, fontSize: 10 }, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', gridIndex: 2, min: -1, max: 1, name: 'heat', nameTextStyle: { color: AXIS, fontSize: 10 }, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1, 2], start: props.zoom[0], end: props.zoom[1] }, { type: 'slider', xAxisIndex: [0, 1, 2], start: props.zoom[0], end: props.zoom[1], bottom: 4, height: 14, borderColor: '#36425f', fillerColor: 'rgba(79,142,247,0.18)', textStyle: { color: AXIS, fontSize: 9 } }],
    series: [
      {
        name: 'b', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: d.b, symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.5 },
        markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#5a6480', type: 'dashed' }, data: [{ yAxis: 0 }, { yAxis: 1 }, { yAxis: -1 }] },
        markArea: runArea,
      },
      { name: 'τ', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.tau, symbol: 'none', lineStyle: { color: '#f7931a', width: 1 } },
      { name: 'vote', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.vote, symbol: 'none', lineStyle: { color: '#2bd4a7', width: 1.5 } },
      ...perHeat,
      { name: 'fW', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.fW, symbol: 'none', lineStyle: { color: '#4f8ef7', width: 1, type: 'dashed', opacity: 0.7 } },
      { name: 'fM', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.fM, symbol: 'none', lineStyle: { color: '#f74b4b', width: 1, type: 'dashed', opacity: 0.7 } },
      { name: 'composite', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: props.result.heat, symbol: 'none', lineStyle: { color: '#fff', width: 2 } },
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
  render()
  // Emit zoom changes so the main price chart stays in sync (two-way).
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
watch(() => [props.dates, props.result, horizon.value, props.zoom], render)
</script>

<template>
  <div class="diag">
    <div class="diag-controls">
      <span class="muted">Components — horizon:</span>
      <button
        v-for="h in available"
        :key="h"
        :class="{ active: horizon === h }"
        @click="horizon = h"
      >
        {{ h }}
      </button>
    </div>
    <div ref="el" class="diag-chart"></div>
    <p class="muted note">
      Top: band position b (0 = MA, ±1 = bands), shaded by sustainment run —
      <span class="swatch up">green</span> = sustained up-run,
      <span class="swatch down">red</span> = sustained down-run, gaps = chop. A W
      is a down-run below the MA, up, a down-run crossing to below the MA, then
      the breakout up-run. Middle: τ (fast trend), vote (sustained trend), and
      the template match scores fW (blue dashed) vs fM (red dashed) — heat is
      driven by their difference. Bottom: each horizon's heat + white composite.
    </p>
  </div>
</template>

<style scoped>
.diag {
  margin-top: 0.5rem;
}
.diag-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
  flex-wrap: wrap;
}
.diag-controls button {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  text-transform: capitalize;
}
.diag-controls button.active {
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}
.diag-chart {
  width: 100%;
  height: 640px;
}
.muted {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.note {
  line-height: 1.45;
  margin-top: 0.3rem;
}
.swatch {
  padding: 0 0.3rem;
  border-radius: 3px;
  font-weight: 600;
}
.swatch.up {
  background: rgba(43, 212, 167, 0.28);
  color: #2bd4a7;
}
.swatch.down {
  background: rgba(247, 75, 75, 0.26);
  color: #f74b4b;
}
</style>
