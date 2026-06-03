// Period units shared by the indicator controls. Data is daily, so week/month
// periods just scale the sample count.

export type PeriodUnit = 'day' | 'week' | 'month'

export const UNIT_DAYS: Record<PeriodUnit, number> = { day: 1, week: 7, month: 30 }
export const UNIT_ABBR: Record<PeriodUnit, string> = { day: 'd', week: 'w', month: 'mo' }

export const toDays = (period: number, unit: PeriodUnit) =>
  Math.max(1, Math.round(period * UNIT_DAYS[unit]))
