// Period units shared by the indicator controls. Data is daily, so week/month
// periods just scale the sample count.

export type PeriodUnit = 'day' | 'week' | 'month'

export const UNIT_DAYS: Record<PeriodUnit, number> = { day: 1, week: 7, month: 30 }
export const UNIT_ABBR: Record<PeriodUnit, string> = { day: 'd', week: 'w', month: 'mo' }

export const toDays = (period: number, unit: PeriodUnit) =>
  Math.max(1, Math.round(period * UNIT_DAYS[unit]))

// Named horizon buckets for labelling a day-count (e.g. the run-detection scale
// and the Bollinger-score smoothing). Snaps to the nearest by log-distance.
const NAMED_SCALES: { name: string; days: number }[] = [
  { name: 'daily', days: 1 },
  { name: 'weekly', days: 7 },
  { name: 'monthly', days: 30 },
  { name: 'seasonal', days: 90 },
  { name: 'yearly', days: 365 },
  { name: 'multi-year', days: 1460 },
]

/** e.g. 31 → "monthly · 31d"; 0 → "none". */
export function namedScaleLabel(days: number): string {
  if (!days || days <= 0) return 'none'
  let best = NAMED_SCALES[0]
  let bestD = Infinity
  for (const s of NAMED_SCALES) {
    const dist = Math.abs(Math.log(days) - Math.log(s.days))
    if (dist < bestD) {
      bestD = dist
      best = s
    }
  }
  return `${best.name} · ${days}d`
}
