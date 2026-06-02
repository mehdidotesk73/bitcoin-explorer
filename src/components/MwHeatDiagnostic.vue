<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { MwHeatResult, Horizon } from '../lib/mwheat'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent, CanvasRenderer])

const UP_RUN = 'rgba(43, 212, 167, 0.16)' // sustained up-run shading
const DOWN_RUN = 'rgba(247, 75, 75, 0.14)' // sustained down-run shading

const props = defineProps<{
  dates: string[]
  result: MwHeatResult
  /** Smoothed (moving-average) composite signal, plotted on the heat panel. */
  signal?: number[]
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

  // Each panel gets its own header band: an info line (title) + its own legend,
  // stacked above its grid. The three grids share one chart, so the x-axis,
  // crosshair and zoom stay linked across panels.
  const S = [6, 242, 478] // header top of each panel (px)
  const GRID = (i: number) => ({ left: 48, right: 12, top: S[i] + 52, height: 150 })
  const legendBase = { type: 'plain' as const, itemWidth: 13, itemHeight: 8, itemGap: 8, textStyle: { color: '#e7eaf3', fontSize: 9 }, inactiveColor: '#5a6480' }
  const titleBase = { left: 48, textStyle: { color: '#cdd3e4', fontSize: 11, fontWeight: 'normal' as const } }

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(20,27,42,0.95)', borderColor: '#36425f', textStyle: { color: '#e7eaf3' } },
    // Linked crosshair + x-axis across all three panels.
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#8b94ac', type: 'dashed' } },
    title: [
      { ...titleBase, top: S[0], text: `b = (EMA price − MA) / (k·σ)    + above MA · − below MA   (${d.horizon})` },
      { ...titleBase, top: S[1], text: 'τ = slope of smoothed price · vote = sustained direction (share of up days, −1…1)' },
      { ...titleBase, top: S[2], text: 'heat:  + = M (top/bearish) · − = W (bottom/bullish) · composite & rolling signal' },
    ],
    legend: [
      { ...legendBase, left: 48, top: S[0] + 22, data: ['b'] },
      { ...legendBase, left: 48, top: S[1] + 22, data: ['τ', 'vote', 'fW', 'fM'] },
      { ...legendBase, left: 48, top: S[2] + 22, data: ['daily H', 'weekly H', 'monthly H', 'composite', 'rolling signal'] },
    ],
    grid: [GRID(0), GRID(1), GRID(2)],
    xAxis: [
      { type: 'category', data: cats, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: AXIS } } },
      { type: 'category', data: cats, gridIndex: 1, axisLabel: { show: false }, axisLine: { lineStyle: { color: AXIS } } },
      { type: 'category', data: cats, gridIndex: 2, axisLabel: { color: AXIS, fontSize: 9 }, axisLine: { lineStyle: { color: AXIS } } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', gridIndex: 1, min: -1, max: 1, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', gridIndex: 2, min: -1, max: 1, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
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
      { name: 'rolling signal', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: props.signal ?? [], symbol: 'none', lineStyle: { color: '#ffd166', width: 2.5 } },
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
watch(() => [props.dates, props.result, props.signal, horizon.value, props.zoom], render)
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
      <strong>b (band position)</strong> = (EMA of price − MA) / (k·σ): 0 = at the
      MA, +1 = upper band, −1 = lower band. <em>Positive b</em> = price above its
      moving average, <em>negative b</em> = below. Shaded by sustainment run —
      <span class="swatch up">green</span> = sustained up-run,
      <span class="swatch down">red</span> = sustained down-run, gaps = chop.
      <strong>τ</strong> is the fast trend (slope of the smoothed price);
      <strong>vote</strong> is the sustained trend — the share of up-days over the
      window mapped to −1…1, so it's the run-sustainment the matcher reads.
      <strong>fW / fM</strong> are the W- and M-template match scores; heat is
      driven by their difference. <strong>Heat panel:</strong> per-horizon heat +
      the white <strong>composite</strong> (+ = M / top, − = W / bottom) and the
      gold <strong>rolling signal</strong> (the moving-average buy/sell signal).
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
  height: 720px;
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
