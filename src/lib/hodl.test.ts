import { describe, it, expect } from 'vitest'
import {
  simulateStrategy,
  selectBandBuyDates,
  windowIndices,
  unionIndices,
  snapDateToIndex,
  uniformSpacedDates,
} from './hodl'

describe('simulateStrategy', () => {
  it('computes BTC, value, ROI and cost basis for equal buys', () => {
    // budget 100 split over 2 days; buy at 100 then 200; value at last price 200.
    const s = simulateStrategy([100, 200], [0, 1], 100)!
    expect(s.btcAccumulated).toBeCloseTo(0.75, 10) // 50/100 + 50/200
    expect(s.currentValue).toBeCloseTo(150, 10) // 0.75 * 200
    expect(s.roi).toBeCloseTo(0.5, 10)
    expect(s.costBasis).toBeCloseTo(133.333, 2) // 100 / 0.75
    expect(s.numBuys).toBe(2)
  })

  it('returns null when there are no buy days', () => {
    expect(simulateStrategy([100, 200], [], 100)).toBeNull()
  })
})

describe('selectBandBuyDates', () => {
  it('keeps candidates whose metric is within the band (nulls excluded)', () => {
    const metric = [0.5, null, 1.5, 0.8]
    expect(selectBandBuyDates(metric, { lower: 0, upper: 1 }, [0, 1, 2, 3])).toEqual([0, 3])
  })
})

describe('windowIndices', () => {
  it('returns the trailing X indices', () => {
    expect(windowIndices(10, 3)).toEqual([7, 8, 9])
  })
})

describe('unionIndices', () => {
  it('merges, dedupes and sorts', () => {
    expect(
      unionIndices([
        [1, 3],
        [2, 3, 5],
      ]),
    ).toEqual([1, 2, 3, 5])
  })
})

describe('snapDateToIndex', () => {
  it('snaps an ISO date to the nearest day index', () => {
    const dates = ['2020-01-01', '2020-01-02', '2020-01-03']
    expect(snapDateToIndex(dates, '2020-01-02')).toBe(1)
    expect(snapDateToIndex(dates, '2020-01-03')).toBe(2)
  })
})

describe('uniformSpacedDates', () => {
  it('grids every X days on a phase anchored at today + offset', () => {
    // n=10, anchor = 9, every 3 → i ≡ 0 (mod 3)
    expect(uniformSpacedDates(10, 3, 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([0, 3, 6, 9])
  })
})
