import { ref, computed, toValue, type MaybeRefOrGetter } from 'vue'
import { bandPosition } from './indicators'
import { type PeriodUnit, UNIT_ABBR, toDays, namedScaleLabel } from './period'

/**
 * The tunable "Bollinger score" band-position metric, shared by the Price
 * Explorer curve and the Hodl Explorer driver. Each call owns its own
 * Period / unit / σ / smoothing state (the two tabs stay independent).
 *
 * `series[i] = (EMA_smooth(price) − SMA_window) / (k · STD_window)`, centered at
 * 0 with ±1 on the ±kσ bands. Defaults reproduce the canonical look (20 months,
 * 2σ, 31-day EMA).
 */
export function useBandScore(prices: MaybeRefOrGetter<number[]>) {
  const smooth = ref(31) // EMA span (days) on the price
  const period = ref(20) // mean + std period (in `unit`)
  const unit = ref<PeriodUnit>('month')
  const k = ref(2) // σ-multiplier; ±1 = the ±kσ bands

  const windowDays = computed(() => toDays(period.value, unit.value))
  const label = computed(
    () =>
      `${period.value}${UNIT_ABBR[unit.value]} · ${k.value}σ` +
      (smooth.value > 0 ? ` · ema ${smooth.value}d` : ''),
  )
  const smoothLabel = computed(() => namedScaleLabel(smooth.value))
  const series = computed(() =>
    bandPosition(toValue(prices), smooth.value, windowDays.value, k.value),
  )

  return { smooth, period, unit, k, windowDays, label, smoothLabel, series }
}
