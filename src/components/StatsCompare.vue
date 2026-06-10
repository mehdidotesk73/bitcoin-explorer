<script setup lang="ts">
import { computed } from 'vue'
import type { HodlStats } from '../lib/hodl'
import { fmtUSD, fmtPct, fmtBtc } from '../lib/format'
import InfoTip from './InfoTip.vue'

const props = defineProps<{
  /** Primary column label (e.g. "Strategy" or "Preview"). */
  label: string
  /** Class on the primary heading (colours it). */
  labelClass: string
  /** Sub-line under the primary heading. */
  sub: string
  primary: HodlStats | null
  baseline: HodlStats | null
  /** Sub-line under the baseline heading. */
  baselineSub: string
}>()

const edge = computed(() => {
  const p = props.primary
  const b = props.baseline
  if (!p || !b) return null
  return {
    value: b.currentValue ? (p.currentValue - b.currentValue) / b.currentValue : 0,
    valuePos: p.currentValue >= b.currentValue,
    roi: p.roi - b.roi,
    roiPos: p.roi >= b.roi,
    basis: b.costBasis ? (b.costBasis - p.costBasis) / b.costBasis : 0,
    basisPos: p.costBasis <= b.costBasis,
    btc: b.btcAccumulated ? (p.btcAccumulated - b.btcAccumulated) / b.btcAccumulated : 0,
    btcPos: p.btcAccumulated >= b.btcAccumulated,
  }
})
</script>

<template>
  <section class="stats" v-if="primary && baseline">
    <div class="stat-col">
      <h3 class="col-head" :class="labelClass">{{ label }}</h3>
      <p class="col-sub">{{ sub }}</p>
      <div class="stat-row">
        <span class="stat-label">Current value</span>
        <span class="stat-val">{{ fmtUSD(primary.currentValue) }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">ROI <InfoTip term="roi" /></span>
        <span class="stat-val" :class="primary.roi >= 0 ? 'pos' : 'neg'">{{
          fmtPct(primary.roi)
        }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Cost basis <InfoTip term="costBasis" /></span>
        <span class="stat-val">{{ fmtUSD(primary.costBasis) }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">BTC held</span>
        <span class="stat-val">{{ fmtBtc(primary.btcAccumulated) }}</span>
      </div>
    </div>

    <div class="stat-col">
      <h3 class="col-head baseline">Baseline <InfoTip term="baseline" /></h3>
      <p class="col-sub">{{ baselineSub }}</p>
      <div class="stat-row">
        <span class="stat-label">Current value</span>
        <span class="stat-val">{{ fmtUSD(baseline.currentValue) }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">ROI</span>
        <span class="stat-val" :class="baseline.roi >= 0 ? 'pos' : 'neg'">{{
          fmtPct(baseline.roi)
        }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Cost basis</span>
        <span class="stat-val">{{ fmtUSD(baseline.costBasis) }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">BTC held</span>
        <span class="stat-val">{{ fmtBtc(baseline.btcAccumulated) }}</span>
      </div>
    </div>

    <div class="stat-col edge" v-if="edge">
      <h3 class="col-head">Edge</h3>
      <p class="col-sub">{{ label }} vs baseline</p>
      <div class="stat-row">
        <span class="stat-label">Value edge</span>
        <span class="stat-val" :class="edge.valuePos ? 'pos' : 'neg'">{{
          fmtPct(edge.value)
        }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">ROI edge</span>
        <span class="stat-val" :class="edge.roiPos ? 'pos' : 'neg'">{{ fmtPct(edge.roi) }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Cost basis edge</span>
        <span class="stat-val" :class="edge.basisPos ? 'pos' : 'neg'">{{
          fmtPct(edge.basis)
        }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">BTC edge</span>
        <span class="stat-val" :class="edge.btcPos ? 'pos' : 'neg'">{{ fmtPct(edge.btc) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
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
.col-head.strategy {
  color: #2bd4a7;
}
.col-head.preview {
  color: #fbbf24;
}
.col-head.baseline {
  color: #4f8ef7;
}
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
.pos {
  color: #2bd4a7;
}
.neg {
  color: #f74b4b;
}
</style>
