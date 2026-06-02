<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ScaleDiag } from '../lib/runs'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, TitleComponent, CanvasRenderer])

const GROUP = 'btc-explorer'
const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'
const UP_RUN = 'rgba(43, 212, 167, 0.16)'
const DOWN_RUN = 'rgba(247, 75, 75, 0.14)'
const UP = '#2bd4a7'
const DOWN = '#f74b4b'

// Per-panel layout (px).
const TOP = 6
const PITCH = 178
const GRID_TOP_OFF = 38
const GRID_H = 104

const props = defineProps<{
  dates: string[]
  price: number[]
  ma: (number | null)[]
  maLabel: string
  diag: ScaleDiag
  scaleLabel: string
  showRatio: boolean
  showB: boolean
  showRunSlope: boolean
  zoom: [number, number]
}>()
const emit = defineEmits<{ 'update:zoom': [value: [number, number]] }>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()
let suppressZoomEvent = false
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

type Kind = 'ratio' | 'b' | 'slope'
const panels = computed<Kind[]>(() => {
  const out: Kind[] = []
  if (props.showRatio) out.push('ratio')
  if (props.showB) out.push('b')
  if (props.showRunSlope) out.push('slope')
  return out
})
const chartHeight = computed(() => TOP + (panels.value.length - 1) * PITCH + GRID_TOP_OFF + GRID_H + 40)

const priceMa = computed(() =>
  props.price.map((p, i) => {
    const m = props.ma[i]
    return m != null && m > 0 ? p / m : null
  }),
)

// Per-run average slope (daily %), measured on the SMOOTHED price the runs are
// built from and coloured by run direction — so it agrees with the b-shading.
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
  const cats = props.dates
  const d = props.diag
  const list = panels.value
  const last = list.length - 1
  const runArea = {
    silent: true,
    data: d.runs.map((r) => [
      { xAxis: cats[r.start], itemStyle: { color: r.dir > 0 ? UP_RUN : DOWN_RUN } },
      { xAxis: cats[r.end] },
    ]),
  }
  const { out: slope, dir } = runSlope.value
  const slopeData = slope.map((v, i) => ({
    value: v,
    itemStyle: { color: dir[i] > 0 ? UP : dir[i] < 0 ? DOWN : 'transparent' },
  }))

  const titleBase = { left: 52, textStyle: { color: '#cdd3e4', fontSize: 11, fontWeight: 'normal' as const } }
  const legendBase = { type: 'plain' as const, itemWidth: 13, itemHeight: 8, itemGap: 8, textStyle: { color: '#e7eaf3', fontSize: 9 }, inactiveColor: '#5a6480' }

  const TITLE: Record<Kind, string> = {
    ratio: `Price ÷ MA  (${props.maLabel} MA, log)    > 1 = above · < 1 = below (oversold)`,
    b: `b = band position · shaded by run (green up · red down · gaps = chop)   (${props.scaleLabel})`,
    slope: `Run slope  (avg % per day · green up-run · red down-run · flat 0 = chop)   (${props.scaleLabel})`,
  }
  const LEGEND: Record<Kind, string> = { ratio: 'price ÷ MA', b: 'b', slope: 'run slope' }

  const title: any[] = []
  const legend: any[] = []
  const grid: any[] = []
  const xAxis: any[] = []
  const yAxis: any[] = []
  const series: any[] = []

  list.forEach((kind, i) => {
    const S = TOP + i * PITCH
    title.push({ ...titleBase, top: S, text: TITLE[kind] })
    legend.push({ ...legendBase, left: 52, top: S + 20, data: [LEGEND[kind]] })
    grid.push({ left: 52, right: 12, top: S + GRID_TOP_OFF, height: GRID_H })
    xAxis.push({
      type: 'category', data: cats, gridIndex: i,
      axisLabel: i === last ? { color: AXIS, fontSize: 9 } : { show: false },
      axisLine: { lineStyle: { color: AXIS } },
    })
    yAxis.push({
      type: kind === 'ratio' ? 'log' : 'value', gridIndex: i,
      axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: SPLIT } },
    })
    const dash = { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#5a6480', type: 'dashed' as const } }
    if (kind === 'ratio') {
      series.push({
        name: LEGEND.ratio, type: 'line', xAxisIndex: i, yAxisIndex: i, data: priceMa.value, symbol: 'none',
        lineStyle: { color: '#f7931a', width: 1.4 }, markLine: { ...dash, data: [{ yAxis: 1 }] },
      })
    } else if (kind === 'b') {
      series.push({
        name: LEGEND.b, type: 'line', xAxisIndex: i, yAxisIndex: i, data: d.b, symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.5 },
        markLine: { ...dash, data: [{ yAxis: 0 }, { yAxis: 1 }, { yAxis: -1 }] }, markArea: runArea,
      })
    } else {
      series.push({
        name: LEGEND.slope, type: 'bar', xAxisIndex: i, yAxisIndex: i, data: slopeData, barCategoryGap: '0%',
        markLine: { ...dash, data: [{ yAxis: 0 }] },
      })
    }
  })

  const allIdx = list.map((_, i) => i)
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(20,27,42,0.95)', borderColor: '#36425f', textStyle: { color: '#e7eaf3' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#8b94ac', type: 'dashed' } },
    title, legend, grid, xAxis, yAxis, series,
    dataZoom: [
      { type: 'inside', xAxisIndex: allIdx, start: props.zoom[0], end: props.zoom[1] },
      { type: 'slider', xAxisIndex: allIdx, start: props.zoom[0], end: props.zoom[1], bottom: 6, height: 12, borderColor: '#36425f', fillerColor: 'rgba(79,142,247,0.18)', textStyle: { color: AXIS, fontSize: 9 } },
    ],
  }
}

async function render() {
  if (!chart.value || !panels.value.length) return
  suppressZoomEvent = true
  chart.value.setOption(buildOption(), { notMerge: true })
  suppressZoomEvent = false
  await nextTick()
  chart.value.resize()
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
watch(
  () => [props.dates, props.price, props.ma, props.maLabel, props.diag, props.scaleLabel, panels.value, props.zoom],
  render,
)
</script>

<template>
  <div ref="el" class="metrics-chart" :style="{ height: chartHeight + 'px' }"></div>
</template>

<style scoped>
.metrics-chart {
  width: 100%;
  margin-top: 0.5rem;
}
</style>
