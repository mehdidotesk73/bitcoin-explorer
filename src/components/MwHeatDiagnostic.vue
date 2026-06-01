<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { MwHeatResult, Horizon } from '../lib/mwheat'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer])

const props = defineProps<{
  dates: string[]
  result: MwHeatResult
}>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()
const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'

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
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1, 2], start: 0, end: 100 }, { type: 'slider', xAxisIndex: [0, 1, 2], start: 0, end: 100, bottom: 4, height: 14, borderColor: '#36425f', fillerColor: 'rgba(79,142,247,0.18)', textStyle: { color: AXIS, fontSize: 9 } }],
    series: [
      {
        name: 'b', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: d.b, symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.5 },
        markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#5a6480', type: 'dashed' }, data: [{ yAxis: 0 }, { yAxis: 1 }, { yAxis: -1 }] },
      },
      { name: 'τ', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.tau, symbol: 'none', lineStyle: { color: '#f7931a', width: 1 } },
      { name: 'vote', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.vote, symbol: 'none', lineStyle: { color: '#2bd4a7', width: 1.5 } },
      ...perHeat,
      { name: 'composite', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: props.result.heat, symbol: 'none', lineStyle: { color: '#fff', width: 2 } },
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
watch(() => [props.dates, props.result, horizon.value], render)
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
      Top: band position b (0 = MA, ±1 = bands) — the signal the phase machine
      reads. Middle: τ (fast trend) vs vote (sustained trend). Bottom: each
      horizon's heat + the white composite. M/W shapes should be visible as
      humps/dips in b.
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
  height: 420px;
}
.muted {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.note {
  line-height: 1.45;
  margin-top: 0.3rem;
}
</style>
