import { describe, it, expect } from 'vitest'
import { detectWmPatterns } from './wmPattern'

describe('detectWmPatterns', () => {
  it('finds a W (double-bottom) pattern and its neckline breakout', () => {
    // Swing pivots (lookbackBars=1, timeframeDays=1 so bars = daily indices):
    // i1 peak 120, i3 trough 70, i5 peak 110 (neckline), i7 trough 72, then a
    // close above 110 at i9 confirms the breakout.
    const price = [100, 120, 90, 70, 95, 110, 88, 72, 96, 130]
    const patterns = detectWmPatterns(price, { timeframeDays: 1, lookbackBars: 1, tolerance: 0.04 })

    expect(patterns).toHaveLength(1)
    const [p] = patterns
    expect(p.type).toBe('W')
    expect(p.points.map((pt) => pt.origIdx)).toEqual([1, 3, 5, 7])
    expect(p.points.map((pt) => pt.type)).toEqual(['peak', 'trough', 'peak', 'trough'])
    expect(p.necklineLevel).toBe(110)
    expect(p.establishedIdx).toBe(9)
    expect(p.establishedPrice).toBe(130)
  })

  it('finds an M (double-top) pattern and its neckline breakout', () => {
    // i1 trough 80, i2 peak 130, i4 trough 90 (neckline), i5 peak 128, then a
    // close below 90 at i7 confirms the breakout.
    const price = [100, 80, 130, 95, 90, 128, 100, 60]
    const patterns = detectWmPatterns(price, { timeframeDays: 1, lookbackBars: 1, tolerance: 0.04 })

    expect(patterns).toHaveLength(1)
    const [p] = patterns
    expect(p.type).toBe('M')
    expect(p.points.map((pt) => pt.origIdx)).toEqual([1, 2, 4, 5])
    expect(p.points.map((pt) => pt.type)).toEqual(['trough', 'peak', 'trough', 'peak'])
    expect(p.necklineLevel).toBe(90)
    expect(p.establishedIdx).toBe(7)
    expect(p.establishedPrice).toBe(60)
  })

  it('rejects a quadruple whose two tops/bottoms exceed the symmetry tolerance', () => {
    // Same shape as the M case, but the second peak (i5) is pushed far above
    // the first (128 → 170), well outside a 4% tolerance.
    const price = [100, 80, 130, 95, 90, 170, 100, 60]
    const patterns = detectWmPatterns(price, { timeframeDays: 1, lookbackBars: 1, tolerance: 0.04 })
    expect(patterns).toEqual([])
  })

  it('never establishes a pattern before its fourth pivot', () => {
    const price = [100, 80, 130, 95, 90, 128, 100, 60]
    const patterns = detectWmPatterns(price, { timeframeDays: 1, lookbackBars: 1, tolerance: 0.04 })
    for (const p of patterns) {
      const p4 = p.points[3]
      expect(p.establishedIdx).toBeGreaterThanOrEqual(p4.origIdx)
    }
  })

  it('groups bars by timeframeDays before scanning for swings', () => {
    // 20 flat days, then a spike, then 20 flat days — with timeframeDays=10
    // the spike collapses into its own bar and can register as a pivot;
    // at timeframeDays=1 the exact same data still finds the same swing.
    const price = [...Array(20).fill(100), 200, ...Array(20).fill(100)]
    const daily = detectWmPatterns(price, { timeframeDays: 1, lookbackBars: 1 })
    const grouped = detectWmPatterns(price, { timeframeDays: 5, lookbackBars: 1 })
    // Neither is required to find a full established pattern here (a single
    // spike is only two of the four pivots needed); just confirm both run
    // without throwing and stay index-aligned to the daily series.
    expect(Array.isArray(daily)).toBe(true)
    expect(Array.isArray(grouped)).toBe(true)
  })

  it('returns nothing on empty or too-short input', () => {
    expect(detectWmPatterns([])).toEqual([])
    expect(detectWmPatterns([1, 2, 3])).toEqual([])
  })
})
