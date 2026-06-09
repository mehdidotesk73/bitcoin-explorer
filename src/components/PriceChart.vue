<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { fmtUSD } from '../lib/format'
import { AXIS, SPLIT } from '../lib/chartTheme'
import { useChartSync } from '../lib/useChartSync'

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
}>()

const emit = defineEmits<{
  'update:zoom': [value: [number, number]]
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
    // Native crosshair: the axisPointer line + tooltip are mirrored across every
    // figure by the shared `echarts.connect` group (see useChartSync).
    axisPointer: { lineStyle: { color: '#8b94ac', type: 'dashed' } },
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

// Join the shared connect group (native crosshair/tooltip + zoom sync) and keep
// the parent's graphed-range model in step for the slider + preset buttons.
const { attach } = useChartSync({
  chart,
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

watch(
  () => [props.dates, props.price, props.ma, props.upper, props.lower, props.showMa, props.showBb, props.runOverlay, props.showRuns],
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
