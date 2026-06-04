<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { fmtUSD } from '../lib/format'
import { AXIS, SPLIT } from '../lib/chartTheme'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])

const props = defineProps<{
  dates: string[]
  price: number[]
  ma: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
  maLabel: string
  bbLabel: string
  /** Draw the MA overlay when true. */
  showMa?: boolean
  /** Draw the Bollinger band overlay when true. */
  showBb?: boolean
  /** Per-day price anchored at run boundaries (null between) → piecewise-linear
   *  run skeleton; each run segment's slope is its average pace. */
  runOverlay?: (number | null)[]
  /** Draw the run skeleton over the price when true. */
  showRuns?: boolean
  /** Graphed-range window as [startPercent, endPercent], 0–100. */
  zoom: [number, number]
  /** Externally-driven hovered day index (crosshair bridge); null = none. */
  hoverIndex?: number | null
}>()

const emit = defineEmits<{
  'update:zoom': [value: [number, number]]
  hover: [number | null]
}>()

const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()


function buildOption(): echarts.EChartsCoreOption {
  const maOn = !!props.showMa
  const bbOn = !!props.showBb
  const runsOn =
    !!props.showRuns && !!props.runOverlay && props.runOverlay.length === props.price.length

  // Bollinger fill: an invisible baseline at the lower band plus the band
  // thickness (upper − lower) rendered as an area.
  const bandSpan = props.upper.map((u, i) => {
    const l = props.lower[i]
    return u == null || l == null ? null : u - l
  })

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 56, right: 16, top: 48, bottom: 72 },
    legend: {
      data: [
        'Price',
        ...(maOn ? [`MA (${props.maLabel})`] : []),
        ...(bbOn ? [`Bollinger (${props.bbLabel})`] : []),
        ...(runsOn ? ['Runs'] : []),
      ],
      top: 8,
      textStyle: { color: '#e7eaf3' },
      inactiveColor: '#5a6480',
    },
    // Crosshair line styling (the cross-chart sync is driven explicitly by the
    // hover bridge below, not by echarts.connect, which didn't reliably mirror
    // the pointer from the separate-curve panels back to here).
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      lineStyle: { color: '#8b94ac', type: 'dashed' },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 27, 42, 0.95)',
      borderColor: '#36425f',
      textStyle: { color: '#e7eaf3' },
      formatter: (params: any) => {
        const i = params[0].dataIndex
        const rows = [`<strong>${props.dates[i]}</strong>`, `Price: ${fmtUSD(props.price[i])}`]
        if (maOn) rows.push(`MA (${props.maLabel}): ${fmtUSD(props.ma[i])}`)
        if (bbOn) {
          rows.push(`Upper: ${fmtUSD(props.upper[i])}`)
          rows.push(`Lower: ${fmtUSD(props.lower[i])}`)
        }
        return rows.join('<br/>')
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
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { color: AXIS, formatter: (v: number) => fmtUSD(v) },
      splitLine: { lineStyle: { color: SPLIT } },
    },
    dataZoom: [
      { type: 'inside', start: props.zoom[0], end: props.zoom[1] },
      {
        type: 'slider',
        start: props.zoom[0],
        end: props.zoom[1],
        bottom: 16,
        borderColor: '#36425f',
        fillerColor: 'rgba(79, 142, 247, 0.18)',
        textStyle: { color: AXIS },
      },
    ],
    series: [
      // --- Bollinger band fill + boundaries ---
      ...(bbOn
        ? [
            {
              name: '__bb_base',
              type: 'line' as const,
              data: props.lower,
              stack: 'bb',
              symbol: 'none',
              lineStyle: { opacity: 0 },
              silent: true,
            },
            {
              name: `Bollinger (${props.bbLabel})`,
              type: 'line' as const,
              data: bandSpan,
              stack: 'bb',
              symbol: 'none',
              lineStyle: { opacity: 0 },
              areaStyle: { color: 'rgba(155, 109, 255, 0.16)' },
            },
            {
              name: '__bb_upper',
              type: 'line' as const,
              data: props.upper,
              symbol: 'none',
              lineStyle: { color: 'rgba(155, 109, 255, 0.55)', width: 1, type: 'dashed' as const },
              silent: true,
            },
            {
              name: '__bb_lower',
              type: 'line' as const,
              data: props.lower,
              symbol: 'none',
              lineStyle: { color: 'rgba(155, 109, 255, 0.55)', width: 1, type: 'dashed' as const },
              silent: true,
            },
          ]
        : []),
      // --- MA overlay ---
      ...(maOn
        ? [
            {
              name: `MA (${props.maLabel})`,
              type: 'line' as const,
              data: props.ma,
              symbol: 'none',
              lineStyle: { color: '#4f8ef7', width: 1.5 },
            },
          ]
        : []),
      // --- Price (always) ---
      {
        name: 'Price',
        type: 'line',
        data: props.price,
        symbol: 'none',
        lineStyle: { color: '#f7931a', width: 1.5 },
      },
      // --- Run skeleton overlay: piecewise-linear line through run-boundary anchors ---
      ...(runsOn
        ? [
            {
              name: 'Runs',
              type: 'line' as const,
              data: props.runOverlay,
              symbol: 'none',
              connectNulls: true,
              z: 4,
              lineStyle: { color: '#22d3ee', width: 2 },
            },
          ]
        : []),
    ],
  }
}

function render() {
  chart.value?.setOption(buildOption(), { replaceMerge: ['series'] })
}

// Guards against an infinite loop between the chart's `datazoom` event and the
// prop-driven `dispatchAction` below: each can otherwise re-trigger the other.
let suppressZoomEvent = false
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

function currentZoom(): [number, number] {
  const opt = chart.value?.getOption() as any
  const dz = opt?.dataZoom?.[0]
  return dz ? [dz.start ?? 0, dz.end ?? 100] : [0, 100]
}

// --- Crosshair bridge -------------------------------------------------------
// Report the hovered day index to the parent, and mirror the parent's index
// (driven by a sibling chart) onto this one via showTip/hideTip. `selfHover`
// stops the source chart from re-applying its own hover.
let selfHover = false
function pixelToIndex(px: number, py: number): number | null {
  const c = chart.value
  if (!c) return null
  const r = c.convertFromPixel({ gridIndex: 0 }, [px, py]) as number[] | null
  if (!r) return null
  const idx = Math.round(r[0])
  return idx >= 0 && idx < props.dates.length ? idx : null
}
watch(
  () => props.hoverIndex,
  (idx) => {
    if (!chart.value || selfHover) return
    if (idx == null) chart.value.dispatchAction({ type: 'hideTip' })
    else chart.value.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx })
  },
)

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  chart.value.group = 'btc-explorer' // sync x-zoom with the other panels
  render()
  echarts.connect('btc-explorer')
  // Keep the parent's zoom model in sync when the user drags/pinches, but only
  // emit when the value actually changed (and not while we're applying one).
  chart.value.on('datazoom', () => {
    if (suppressZoomEvent) return
    const [start, end] = currentZoom()
    if (near(start, props.zoom[0]) && near(end, props.zoom[1])) return
    emit('update:zoom', [start, end])
  })
  const zr = chart.value.getZr()
  zr.on('mousemove', (ev: any) => {
    const idx = pixelToIndex(ev.offsetX, ev.offsetY)
    if (idx == null) return // in a margin — keep the last position, don't clear
    selfHover = true
    emit('hover', idx)
  })
  // Don't clear on pointer-leave: moving off one chart to a sibling (or lifting
  // a finger) shouldn't drop the shared crosshair. Just release the self-hover
  // guard so a sibling can drive this chart next.
  zr.on('globalout', () => {
    selfHover = false
  })
  resizeObserver.observe(el.value)
})

const resizeObserver = new ResizeObserver(() => chart.value?.resize())

onBeforeUnmount(() => {
  resizeObserver.disconnect()
  chart.value?.dispose()
})

watch(
  () => [props.dates, props.price, props.ma, props.upper, props.lower, props.showMa, props.showBb, props.runOverlay, props.showRuns],
  render,
)

// Apply externally-driven zoom changes (preset range buttons) to the chart.
watch(
  () => props.zoom,
  ([start, end]) => {
    const [cs, ce] = currentZoom()
    if (near(cs, start) && near(ce, end)) return
    suppressZoomEvent = true
    chart.value?.dispatchAction({ type: 'dataZoom', start, end })
    suppressZoomEvent = false
  },
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
