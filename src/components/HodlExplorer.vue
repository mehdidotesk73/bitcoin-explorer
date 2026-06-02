<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { PricePoint, FetchProgress } from '../api/bitcoin'
import { sma } from '../lib/indicators'
import { selectRatioBuyDates, simulateStrategy, simulateBaseline } from '../lib/hodl'

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])

const props = defineProps<{
  raw: PricePoint[]
  loading: boolean
  error: string
  progress: FetchProgress
  /** Shared with Price Explorer — same long MA baseline. */
  ratioMaDays: number
}>()

const emit = defineEmits<{
  'update:ratioMaDays': [value: number]
  refresh: []
}>()

// --- Controls ---------------------------------------------------------------
const threshold = ref(0.85)   // price ÷ MA < threshold → buy
const baselineDays = ref(1460) // trailing days for baseline (default 4yr)

// MA window: synced with Price Explorer via v-model:ratioMaDays.
const localMaDays = computed({
  get: () => props.ratioMaDays,
  set: (v) => emit('update:ratioMaDays', v),
})

// --- Derived data -----------------------------------------------------------
function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const dates = computed(() => props.raw.map((p) => toDateInput(p.time)))
const prices = computed(() => props.raw.map((p) => p.price))
const longMa = computed(() => sma(prices.value, props.ratioMaDays))

const maLabel = computed(() => {
  const yr = props.ratioMaDays / 365
  return yr >= 1 ? `${yr.toFixed(1)}yr` : `${props.ratioMaDays}d`
})

const strategyIndices = computed(() =>
  selectRatioBuyDates(prices.value, longMa.value, threshold.value),
)
const strategyStats = computed(() =>
  simulateStrategy(prices.value, strategyIndices.value),
)
const baselineStats = computed(() =>
  simulateBaseline(prices.value, baselineDays.value),
)

// Scatter data: [date, price] for each buy index.
const strategyBuyPoints = computed(() =>
  strategyIndices.value.map((i) => [dates.value[i], prices.value[i]]),
)

// Baseline buy-date window start index (for shading on the chart).
const baselineStartIdx = computed(() =>
  Math.max(0, prices.value.length - baselineDays.value),
)

const latestPrice = computed(() =>
  prices.value.length ? prices.value[prices.value.length - 1] : null,
)

// --- Chart ------------------------------------------------------------------
const el = ref<HTMLDivElement>()
const chart = shallowRef<echarts.ECharts>()

const fmtUSD = (v: number | null) =>
  v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })

const fmtPct = (v: number | null) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'

const fmtBtc = (v: number | null) =>
  v == null ? '—' : v.toFixed(6) + ' BTC'

function buildOption(): echarts.EChartsCoreOption {
  const AXIS = '#8b94ac'
  const SPLIT = 'rgba(54, 66, 95, 0.45)'
  const cats = dates.value
  const p = prices.value
  const bStart = baselineStartIdx.value

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: '#e7eaf3' },
    grid: { left: 60, right: 16, top: 48, bottom: 72 },
    legend: {
      data: ['Price', `Long MA (${maLabel.value})`, 'Strategy buys', 'Baseline window'],
      top: 8,
      textStyle: { color: '#e7eaf3' },
      inactiveColor: '#5a6480',
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,27,42,0.95)',
      borderColor: '#36425f',
      textStyle: { color: '#e7eaf3' },
      formatter: (params: any) => {
        const i = params[0]?.dataIndex
        if (i == null) return ''
        const rows = [`<strong>${cats[i]}</strong>`, `Price: ${fmtUSD(p[i])}`]
        const m = longMa.value[i]
        if (m) rows.push(`Long MA: ${fmtUSD(m)}`)
        return rows.join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      data: cats,
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
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, bottom: 16, borderColor: '#36425f', fillerColor: 'rgba(79,142,247,0.18)', textStyle: { color: AXIS } },
    ],
    series: [
      // Baseline window shading (area under price for the trailing X days).
      {
        name: 'Baseline window',
        type: 'line',
        data: cats.map((_, i) => (i >= bStart ? p[i] : null)),
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(100, 120, 180, 0.12)' },
        silent: true,
        z: 1,
      },
      // Long MA line.
      {
        name: `Long MA (${maLabel.value})`,
        type: 'line',
        data: longMa.value,
        symbol: 'none',
        lineStyle: { color: '#4f8ef7', width: 1.2, type: 'dashed' },
        z: 2,
      },
      // Price line.
      {
        name: 'Price',
        type: 'line',
        data: p,
        symbol: 'none',
        lineStyle: { color: '#f7931a', width: 1.5 },
        z: 3,
      },
      // Strategy buy markers: scatter dots on the price line.
      {
        name: 'Strategy buys',
        type: 'scatter',
        data: strategyBuyPoints.value,
        symbolSize: 5,
        itemStyle: { color: '#2bd4a7', opacity: 0.8 },
        z: 4,
      },
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
watch(() => [props.raw, props.ratioMaDays, threshold.value, baselineDays.value], render)
</script>

<template>
  <div>
    <p class="latest" v-if="latestPrice">
      Latest close: <strong>{{ fmtUSD(latestPrice) }}</strong>
    </p>

    <section class="status" v-if="loading">
      Loading… {{ progress.bars }} bars over {{ progress.pages }} page(s)
    </section>
    <section class="status error" v-else-if="error">
      ⚠️ {{ error }} <button @click="emit('refresh')">Retry</button>
    </section>

    <!-- Controls -->
    <section class="controls">
      <div class="control-group">
        <label class="ctrl-label">
          MA window
          <span class="ctrl-row">
            <input
              type="number"
              :value="localMaDays"
              @input="localMaDays = Number(($event.target as HTMLInputElement).value)"
              min="30"
              max="2000"
              step="10"
              class="num-input"
            />
            <span class="unit">days · {{ maLabel }}</span>
          </span>
        </label>

        <label class="ctrl-label">
          Buy threshold (price ÷ MA &lt;)
          <span class="ctrl-row">
            <input type="range" v-model.number="threshold" min="0.5" max="1.5" step="0.01" class="slider" />
            <span class="val">{{ threshold.toFixed(2) }}</span>
          </span>
        </label>

        <label class="ctrl-label">
          Baseline days (trailing)
          <span class="ctrl-row">
            <input
              type="number"
              v-model.number="baselineDays"
              min="30"
              max="5000"
              step="30"
              class="num-input"
            />
            <span class="unit">days</span>
          </span>
        </label>
      </div>
    </section>

    <!-- Chart -->
    <div ref="el" class="chart"></div>

    <!-- Stats comparison -->
    <section class="stats" v-if="strategyStats && baselineStats">
      <div class="stat-col">
        <h3 class="col-head strategy">Strategy</h3>
        <p class="col-sub">{{ strategyStats.numBuys }} buy days · {{ (strategyStats.coverage * 100).toFixed(1) }}% of history</p>
        <div class="stat-row">
          <span class="stat-label">Current value</span>
          <span class="stat-val">{{ fmtUSD(strategyStats.currentValue) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">ROI</span>
          <span class="stat-val" :class="strategyStats.roi >= 0 ? 'pos' : 'neg'">
            {{ fmtPct(strategyStats.roi) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Cost basis</span>
          <span class="stat-val">{{ fmtUSD(strategyStats.costBasis) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">BTC held</span>
          <span class="stat-val">{{ fmtBtc(strategyStats.btcAccumulated) }}</span>
        </div>
      </div>

      <div class="stat-col">
        <h3 class="col-head baseline">Baseline</h3>
        <p class="col-sub">Every day · last {{ baselineDays }} days</p>
        <div class="stat-row">
          <span class="stat-label">Current value</span>
          <span class="stat-val">{{ fmtUSD(baselineStats.currentValue) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">ROI</span>
          <span class="stat-val" :class="baselineStats.roi >= 0 ? 'pos' : 'neg'">
            {{ fmtPct(baselineStats.roi) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Cost basis</span>
          <span class="stat-val">{{ fmtUSD(baselineStats.costBasis) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">BTC held</span>
          <span class="stat-val">{{ fmtBtc(baselineStats.btcAccumulated) }}</span>
        </div>
      </div>

      <div class="stat-col edge">
        <h3 class="col-head">Edge</h3>
        <p class="col-sub">Strategy vs baseline</p>
        <div class="stat-row">
          <span class="stat-label">Value edge</span>
          <span class="stat-val" :class="strategyStats.currentValue >= baselineStats.currentValue ? 'pos' : 'neg'">
            {{ fmtPct((strategyStats.currentValue - baselineStats.currentValue) / baselineStats.currentValue) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">ROI edge</span>
          <span class="stat-val" :class="strategyStats.roi >= baselineStats.roi ? 'pos' : 'neg'">
            {{ fmtPct(strategyStats.roi - baselineStats.roi) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Cost basis edge</span>
          <span class="stat-val" :class="strategyStats.costBasis <= baselineStats.costBasis ? 'pos' : 'neg'">
            {{ fmtPct((baselineStats.costBasis - strategyStats.costBasis) / baselineStats.costBasis) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">BTC edge</span>
          <span class="stat-val" :class="strategyStats.btcAccumulated >= baselineStats.btcAccumulated ? 'pos' : 'neg'">
            {{ fmtPct((strategyStats.btcAccumulated - baselineStats.btcAccumulated) / baselineStats.btcAccumulated) }}
          </span>
        </div>
      </div>
    </section>

    <section class="no-buys" v-else-if="!loading && !error && !strategyStats">
      <p>No qualifying buy days at threshold {{ threshold.toFixed(2) }}. Try raising the threshold.</p>
    </section>

    <p class="hint">
      Strategy: buy equally on every day where price ÷ {{ maLabel }} MA &lt; {{ threshold.toFixed(2) }}.
      Baseline: buy equally on every day of the past {{ baselineDays }} days.
      Same total budget on both sides — comparison is purely about timing.
    </p>
  </div>
</template>

<style scoped>
.latest {
  margin: 0 0 0.75rem;
}
.status {
  padding: 0.6rem 0.8rem;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}
.status.error {
  background: var(--danger-bg);
  border-color: var(--danger);
}

.controls {
  margin-bottom: 0.75rem;
}
.control-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: flex-start;
}
.ctrl-label {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: var(--text-muted);
  gap: 0.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.4rem 0.55rem;
  background: var(--bg-elev);
}
.ctrl-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.num-input {
  width: 5rem;
}
.unit {
  color: var(--text-muted);
  font-size: 0.72rem;
}
.slider {
  width: 8rem;
}
.val {
  font-variant-numeric: tabular-nums;
  color: var(--text);
  min-width: 2.4rem;
}

.chart {
  width: 100%;
  height: min(60vh, 500px);
  margin-bottom: 1rem;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.stat-col {
  flex: 1;
  min-width: 9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem 0.75rem;
  background: var(--bg-elev);
}
.col-head {
  margin: 0 0 0.2rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
}
.col-head.strategy { color: #2bd4a7; }
.col-head.baseline { color: #4f8ef7; }
.col-sub {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  color: var(--text-muted);
}
.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.15rem 0;
  border-top: 1px solid var(--border);
  font-size: 0.78rem;
}
.stat-label {
  color: var(--text-muted);
  flex-shrink: 0;
}
.stat-val {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.pos { color: #2bd4a7; }
.neg { color: #f74b4b; }

.no-buys {
  padding: 0.75rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.hint {
  color: var(--text-muted);
  font-size: 0.78rem;
  margin-top: 0.5rem;
}
</style>
