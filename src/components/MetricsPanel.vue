<script setup lang="ts">
// The separate-curve panel. Each active curve is rendered as its own single-grid
// <MetricChart> instance (all in the `btc-explorer` connect group), so the native
// crosshair/tooltip and zoom stay in sync across every figure — the same lean
// structure as the Hodl Explorer. This component is now pure "what to draw": it
// builds each curve's series and hands them down.
import { computed } from 'vue'
import type { ScaleDiag } from '../lib/runs'
import { UP, DOWN, UP_RUN, DOWN_RUN } from '../lib/chartTheme'
import MetricChart from './MetricChart.vue'

const props = defineProps<{
  dates: string[]
  price: number[]
  ma: (number | null)[]
  maLabel: string
  diag: ScaleDiag
  scaleLabel: string
  showRatio: boolean
  showBand: boolean
  band: (number | null)[]
  bandLabel: string
  showRunSlope: boolean
  zoom: [number, number]
}>()
const emit = defineEmits<{ 'update:zoom': [value: [number, number]] }>()

type Kind = 'ratio' | 'band' | 'slope'

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

const dash = {
  symbol: 'none',
  silent: true,
  label: { show: false },
  lineStyle: { color: '#5a6480', type: 'dashed' as const },
}

interface BuiltPanel {
  key: Kind
  title: string
  yType: 'value' | 'log'
  legendData: string[]
  series: any[]
}

const builtPanels = computed<BuiltPanel[]>(() => {
  const cats = props.dates
  const out: BuiltPanel[] = []

  if (props.showRatio) {
    out.push({
      key: 'ratio',
      title: `Price ÷ MA  (${props.maLabel} MA, log)    > 1 = above · < 1 = below (oversold)`,
      yType: 'log',
      legendData: ['price ÷ MA'],
      series: [
        {
          name: 'price ÷ MA',
          type: 'line',
          data: priceMa.value,
          symbol: 'none',
          lineStyle: { color: '#f7931a', width: 1.4 },
          markLine: { ...dash, data: [{ yAxis: 1 }] },
        },
      ],
    })
  }

  if (props.showBand) {
    const runArea = {
      silent: true,
      data: props.diag.runs.map((r) => [
        { xAxis: cats[r.start], itemStyle: { color: r.dir > 0 ? UP_RUN : DOWN_RUN } },
        { xAxis: cats[r.end] },
      ]),
    }
    out.push({
      key: 'band',
      title: `Bollinger score  (0 = MA · ±1 = ±kσ bands · shaded by run: green up · red down · gaps = chop)   (${props.bandLabel})`,
      yType: 'value',
      legendData: ['Bollinger score'],
      series: [
        {
          name: 'Bollinger score',
          type: 'line',
          data: props.band,
          symbol: 'none',
          lineStyle: { color: '#4f8ef7', width: 1.5 },
          markLine: { ...dash, data: [{ yAxis: 0 }, { yAxis: 1 }, { yAxis: -1 }] },
          markArea: runArea,
        },
      ],
    })
  }

  if (props.showRunSlope) {
    const { out: slope, dir } = runSlope.value
    const slopeData = slope.map((v, i) => ({
      value: v,
      itemStyle: { color: dir[i] > 0 ? UP : dir[i] < 0 ? DOWN : 'transparent' },
    }))
    out.push({
      key: 'slope',
      title: `Run slope  (avg % per day · green up-run · red down-run · flat 0 = chop)   (${props.scaleLabel})`,
      yType: 'value',
      legendData: ['run slope'],
      series: [
        {
          name: 'run slope',
          type: 'bar',
          data: slopeData,
          barCategoryGap: '0%',
          markLine: { ...dash, data: [{ yAxis: 0 }] },
        },
      ],
    })
  }

  return out
})
</script>

<template>
  <div class="metrics">
    <MetricChart
      v-for="p in builtPanels"
      :key="p.key"
      :dates="dates"
      :title="p.title"
      :y-type="p.yType"
      :series="p.series"
      :legend-data="p.legendData"
      :zoom="zoom"
      @update:zoom="emit('update:zoom', $event)"
    />
  </div>
</template>

<style scoped>
.metrics {
  margin-top: 0.5rem;
}
</style>
