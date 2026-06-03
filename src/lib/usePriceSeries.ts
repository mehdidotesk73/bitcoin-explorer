import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { PricePoint } from '../api/bitcoin'

/** ISO `YYYY-MM-DD` (UTC) for an epoch-ms timestamp. */
export function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Derive the aligned `prices` and `dates` arrays from a raw price-point list. */
export function usePriceSeries(raw: MaybeRefOrGetter<PricePoint[]>) {
  const prices = computed(() => toValue(raw).map((p) => p.price))
  const dates = computed(() => toValue(raw).map((p) => toDateInput(p.time)))
  return { prices, dates }
}
