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
import { fmtUSD } from '../lib/format'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
])

export interface ChartSeries {
  name: string
  data: (number | null)[]
  color: string
  dashed?: boolean
  width?: number
  /** If set, this series' values define the y-axis range for the x-window. */
  bounds?: boolean
}

const props = defineProps<{
  dates: string[]
  /** Series to plot; all share the numeric x basis below. */
  series: ChartSeries[]
  /** Numeric x for each point: days since the series start (always ≥ 1). */
  x: number[]
  /** Epoch ms of the first sample — origin for converting x back to a date. */
  originMs: number
  logX: boolean
  logY: boolean
  /** x value of "today", drawn as a vertical divider. */
  nowX: number
  /** How to format y values: dollars or a bare ratio multiplier. */
  valueFormat?: 'usd' | 'ratio'
  /** Optional shaded band drawn behind the lines (e.g. modelMa → modelMa×env).
   *  Excluded from y-bounds, legend and tooltip — purely contextual. */
  band?: { lower: (number | null)[]; upper: (number | null)[]; color: string }
}>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()

const fmtRatio = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '×'
const fmtY = (v: number | null) => (props.valueFormat === 'ratio' ? fmtRatio(v) : fmtUSD(v))

const AXIS = '#8b94ac'
const SPLIT = 'rgba(54, 66, 95, 0.45)'

const DAY_MS = 86_400_000

/** Format an x value (days since start) as its calendar year. */
const fmtXYear = (v: number) =>
  new Date(props.originMs + (v - 1) * DAY_MS).getFullYear().toString()

/** Zip a y-series against the numeric x into [x, y] pairs for the chart. */
const pair = (ys: (number | null)[]): [number, number | null][] =>
  ys.map((y, i) => [props.x[i], y])

/** Build a shaded band as a stacked area: an invisible `lower` base plus the
 *  filled `upper − lower` difference. Excluded from legend/tooltip/bounds. */
function bandSeries(): any[] {
  const b = props.band
  if (!b) return []
  const diff = b.upper.map((u, i) => {
    const lo = b.lower[i]
    return u != null && lo != null && u >= lo ? u - lo : null
  })
  const base = {
    type: 'line' as const,
    stack: 'band',
    symbol: 'none',
    silent: true,
    lineStyle: { opacity: 0 },
    z: 0,
  }
  return [
    { ...base, name: '__band_lower', data: pair(b.lower) },
    {
      ...base,
      name: '__band_fill',
      data: pair(diff),
      areaStyle: { color: b.color, opacity: 0.14 },
    },
  ]
}

function buildOption(): echarts.EChartsCoreOption {
  const lineSeries = props.series.map((s, idx) => ({
    name: s.name,
    type: 'line' as const,
    data: pair(s.data),
    symbol: 'none',
    connectNulls: false,
    lineStyle: {
      color: s.color,
      width: s.width ?? 1.5,
      type: s.dashed ? 'dashed' : 'solid',
    },
    itemStyle: { color: s.color },
    // Anchor the "today" divider on the first series only.
    ...(idx === 0
      ? {
          markLine: {
            symbol: 'none',
            silent: true,
            label: { color: AXIS, formatter: 'today', position: 'insideEndTop' },
            lineStyle: { color: '#5a6480', type: 'dotted' },
            data: [{ xAxis: props.nowX }],
          },
        }
      : {}),
  }))

  // Band first so it renders behind the lines.
  const series = [...bandSeries(), ...lineSeries]

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 64, right: 16, top: 48, bottom: 72 },
    legend: {
      data: props.series.map((s) => s.name),
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
        const rows = [`<strong>${props.dates[i]}</strong>`]
        for (const s of props.series) rows.push(`${s.name}: ${fmtY(s.data[i])}`)
        return rows.join('<br/>')
      },
    },
    xAxis: {
      type: props.logX ? 'log' : 'value',
      scale: true,
      min: 'dataMin',
      max: 'dataMax',
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, formatter: fmtXYear },
      splitLine: { show: false },
    },
    yAxis: {
      type: props.logY ? 'log' : 'value',
      // min/max are set explicitly by applyYBounds() to the in-view observed
      // data range; these are just the pre-bounds fallback.
      scale: true,
      min: null,
      max: null,
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, formatter: (v: number) => fmtY(v) },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    dataZoom: [
      // filterMode 'none' keeps the x-window mapping linear (no compounding);
      // the y-range is set explicitly from the in-view data by applyYBounds().
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', start: 0, end: 100 },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        start: 0,
        end: 100,
        bottom: 16,
        borderColor: '#36425f',
        fillerColor: 'rgba(79, 142, 247, 0.18)',
        textStyle: { color: AXIS },
      },
    ],
    series,
  }
}

/** Current visible x-window [x0, x1] in data units, from the dataZoom state. */
function zoomWindow(): [number, number] {
  const xs = props.x
  const lo = xs[0]
  const hi = xs[xs.length - 1]
  let start = 0
  let end = 100
  const dz = (chart.value?.getOption() as any)?.dataZoom?.[0]
  if (dz) {
    start = dz.start ?? 0
    end = dz.end ?? 100
  }
  // Zoom percentages map over the axis scale (log when logX is on).
  if (props.logX && lo > 0 && hi > 0) {
    const a = Math.log(lo)
    const b = Math.log(hi)
    return [Math.exp(a + ((b - a) * start) / 100), Math.exp(a + ((b - a) * end) / 100)]
  }
  return [lo + ((hi - lo) * start) / 100, lo + ((hi - lo) * end) / 100]
}

/** Min/max of the given series over points whose x falls in [x0, x1]. */
function rangeOf(list: ChartSeries[], x0: number, x1: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const s of list) {
    for (let i = 0; i < props.x.length; i++) {
      const xv = props.x[i]
      if (xv < x0 || xv > x1) continue
      const y = s.data[i]
      if (y == null) continue
      if (props.logY && y <= 0) continue // log axis can't show ≤ 0
      if (y < lo) lo = y
      if (y > hi) hi = y
    }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
}

let applyingBounds = false
/** Pin the y-axis floor to the in-view observed data (`bounds` series), but let
 *  the ceiling follow the largest value across all in-view series so nothing is
 *  clipped at the top. Falls back to all series where no observed data is in
 *  the window. */
function applyYBounds() {
  const c = chart.value
  if (!c || applyingBounds || !props.x.length) return
  const [x0, x1] = zoomWindow()
  const flagged = props.series.filter((s) => s.bounds)
  const boundsRange =
    (flagged.length ? rangeOf(flagged, x0, x1) : null) ?? rangeOf(props.series, x0, x1)
  if (!boundsRange) return
  // Floor from the observed/bounds series; ceiling from the full data extent.
  const fullRange = rangeOf(props.series, x0, x1) ?? boundsRange
  let [lo] = boundsRange
  let hi = fullRange[1]
  const MARGIN = 0.04
  if (props.logY && lo > 0 && hi > 0) {
    const a = Math.log(lo)
    const b = Math.log(hi)
    const m = (b - a) * MARGIN || Math.log(1.05)
    lo = Math.exp(a - m)
    hi = Math.exp(b + m)
  } else {
    const m = (hi - lo) * MARGIN || Math.abs(lo) * 0.05 || 1
    lo -= m
    hi += m
  }
  applyingBounds = true
  c.setOption({ yAxis: { min: lo, max: hi } })
  applyingBounds = false
}

function render() {
  chart.value?.setOption(buildOption(), { replaceMerge: ['series'] })
  applyYBounds()
}

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  chart.value.on('datazoom', applyYBounds)
  render()
  resizeObserver.observe(el.value)
})

const resizeObserver = new ResizeObserver(() => chart.value?.resize())

onBeforeUnmount(() => {
  resizeObserver.disconnect()
  chart.value?.dispose()
})

watch(
  () => [
    props.dates,
    props.series,
    props.x,
    props.logX,
    props.logY,
    props.valueFormat,
    props.nowX,
    props.band,
  ],
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
