<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ScaleDiag } from '../lib/mwheat'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent, CanvasRenderer])

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
  /** Run-relevant signals at the selected continuous scale. */
  diag: ScaleDiag
  /** Human label for the run scale (e.g. "monthly · 20d"). */
  scaleLabel: string
  /** Human label for the ratio's MA window (e.g. "4.0yr"). */
  maLabel: string
  /** Graphed-range window [startPercent, endPercent] synced across the tab. */
  zoom: [number, number]
}>()
const emit = defineEmits<{ 'update:zoom': [value: [number, number]] }>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()
let suppressZoomEvent = false
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

const priceMa = computed(() =>
  props.price.map((p, i) => {
    const m = props.ma[i]
    return m != null && m > 0 ? p / m : null
  }),
)

// Per-run average slope as a daily % change, measured on the SMOOTHED price the
// runs are built from (so the sign matches the run's direction), and coloured by
// that direction — so this trace agrees with the b-graph's run shading run for
// run. Flat-zero on the choppy gaps between runs.
const runSlope = computed(() => {
  const d = props.diag
  const n = props.price.length
  const out = new Array<number>(n).fill(0)
  const dir = new Array<number>(n).fill(0)
  const s = d.smoothed
  for (const r of d.runs) {
    const p0 = s[r.start]
    const p1 = s[r.end]
    const span = Math.max(1, r.end - r.start)
    const dailyPct = p0 > 0 && p1 > 0 ? (Math.exp(Math.log(p1 / p0) / span) - 1) * 100 : 0
    for (let i = r.start; i <= r.end; i++) {
      out[i] = dailyPct
      dir[i] = r.dir
    }
  }
  return { out, dir }
})

function buildOption(): echarts.EChartsCoreOption {
  const d = props.diag
  if (!d) return {}
  const cats = props.dates
  const runArea = {
    silent: true,
    data: d.runs.map((r) => [
      { xAxis: cats[r.start], itemStyle: { color: r.dir > 0 ? UP_RUN : DOWN_RUN } },
      { xAxis: cats[r.end] },
    ]),
  }
  const S = [6, 184, 362] // header top of each panel (px)
  const GRID = (i: number) => ({ left: 52, right: 12, top: S[i] + 38, height: 104 })
  const titleBase = { left: 52, textStyle: { color: '#cdd3e4', fontSize: 11, fontWeight: 'normal' as const } }
  const legendBase = { type: 'plain' as const, itemWidth: 13, itemHeight: 8, itemGap: 8, textStyle: { color: '#e7eaf3', fontSize: 9 }, inactiveColor: '#5a6480' }
  const { out: slope, dir } = runSlope.value
  const slopeData = slope.map((v, i) => ({
    value: v,
    itemStyle: { color: dir[i] > 0 ? '#2bd4a7' : dir[i] < 0 ? '#f74b4b' : 'transparent' },
  }))

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(20,27,42,0.95)', borderColor: '#36425f', textStyle: { color: '#e7eaf3' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#8b94ac', type: 'dashed' } },
    title: [
      { ...titleBase, top: S[0], text: `Price ÷ MA  (${props.maLabel} MA, log)    > 1 = above · < 1 = below (oversold)` },
      { ...titleBase, top: S[1], text: `b = band position · shaded by run (green up · red down · gaps = chop)   (${props.scaleLabel})` },
      { ...titleBase, top: S[2], text: `Run slope  (avg % per day · green up-run · red down-run · flat 0 = chop)   (${props.scaleLabel})` },
    ],
    legend: [
      { ...legendBase, left: 52, top: S[0] + 20, data: ['price ÷ MA'] },
      { ...legendBase, left: 52, top: S[1] + 20, data: ['b'] },
      { ...legendBase, left: 52, top: S[2] + 20, data: ['run slope'] },
    ],
    grid: [GRID(0), GRID(1), GRID(2)],
    xAxis: [
      { type: 'category', data: cats, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: AXIS } } },
      { type: 'category', data: cats, gridIndex: 1, axisLabel: { show: false }, axisLine: { lineStyle: { color: AXIS } } },
      { type: 'category', data: cats, gridIndex: 2, axisLabel: { color: AXIS, fontSize: 9 }, axisLine: { lineStyle: { color: AXIS } } },
    ],
    yAxis: [
      { type: 'log', gridIndex: 0, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', gridIndex: 1, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
      { type: 'value', gridIndex: 2, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], start: props.zoom[0], end: props.zoom[1] },
      { type: 'slider', xAxisIndex: [0, 1, 2], start: props.zoom[0], end: props.zoom[1], bottom: 6, height: 12, borderColor: '#36425f', fillerColor: 'rgba(79,142,247,0.18)', textStyle: { color: AXIS, fontSize: 9 } },
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
      {
        name: 'run slope', type: 'bar', xAxisIndex: 2, yAxisIndex: 2, data: slopeData, barCategoryGap: '0%',
        markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#5a6480', type: 'dashed' }, data: [{ yAxis: 0 }] },
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
watch(() => [props.dates, props.price, props.ma, props.diag, props.scaleLabel, props.maLabel, props.zoom], render)
</script>

<template>
  <div class="metrics">
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
  height: 540px;
}
.muted {
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
