import { describe, it, expect } from 'vitest'
import { scheduleFromDates, scheduleDates, removeGap, uniformGapsUntil, meanGap } from './peaks'
import { DAY_MS } from './forecast'

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const PAST = ['2013-11-28', '2017-12-17', '2021-03-17', '2025-07-13'].map(d)
const PROJ = ['2029-07-12', '2033-07-11'].map(d)

describe('scheduleFromDates / scheduleDates', () => {
  it('splits at the cutoff into gaps and rebuilds the same dates', () => {
    const s = scheduleFromDates([...PROJ, ...PAST], d('2026-10-22'))
    expect(s.firstMs).toBe(PAST[0])
    expect(s.pastGaps).toEqual([1480, 1186, 1579])
    expect(s.projGaps).toEqual([1460, 1460])
    expect(scheduleDates(s, 0)).toEqual({ past: PAST, projected: PROJ })
  })

  it('counts projected peaks from the anchor when there are no past peaks', () => {
    const s = { firstMs: null, pastGaps: [], projGaps: [10] }
    expect(scheduleDates(s, d('2026-01-01')).projected).toEqual([d('2026-01-11')])
  })
})

describe('removeGap', () => {
  it('folds the removed gap into the next so later peaks keep their dates', () => {
    expect(removeGap([100, 200, 300], 1)).toEqual([100, 500])
  })

  it('drops the last gap outright', () => {
    expect(removeGap([100, 200], 1)).toEqual([100])
  })
})

describe('uniformGapsUntil / meanGap', () => {
  it('fits as many equal gaps as land on or before the cutoff', () => {
    const from = d('2025-07-13')
    expect(uniformGapsUntil(from, 1460, Date.UTC(2040, 11, 31))).toEqual([1460, 1460, 1460])
    expect(uniformGapsUntil(from, 1460, from + 1459 * DAY_MS)).toEqual([])
  })

  it('averages gaps, or falls back when there are none', () => {
    expect(meanGap([1480, 1186, 1579], 0)).toBe(1415)
    expect(meanGap([], 1460)).toBe(1460)
  })
})
