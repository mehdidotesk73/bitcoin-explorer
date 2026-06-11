import { describe, it, expect } from 'vitest'
import { simplifyCurve } from './simplify'

/** Indices of the kept (non-null) vertices. */
const vertices = (out: (number | null)[]) =>
  out.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0)

describe('simplifyCurve', () => {
  it('returns a same-length array with nulls between vertices', () => {
    const price = [1, 2, 3, 4, 5]
    const out = simplifyCurve(price, { smoothSpan: 0, tolerance: 0.02 })
    expect(out.length).toBe(price.length)
  })

  it('reduces a monotonic line to its two endpoints', () => {
    // exp() so log-price is a straight line → RDP keeps only the ends.
    const price = Array.from({ length: 50 }, (_, i) => Math.exp(i * 0.1))
    const out = simplifyCurve(price, { smoothSpan: 0, tolerance: 0.05 })
    expect(vertices(out)).toEqual([0, 49])
  })

  it('keeps the turning point of a V shape', () => {
    const down = Array.from({ length: 25 }, (_, i) => Math.exp((24 - i) * 0.1))
    const up = Array.from({ length: 25 }, (_, i) => Math.exp((i + 1) * 0.1))
    const price = [...down, ...up] // min at index 24
    const v = vertices(simplifyCurve(price, { smoothSpan: 0, tolerance: 0.02 }))
    expect(v[0]).toBe(0)
    expect(v[v.length - 1]).toBe(price.length - 1)
    expect(v).toContain(24) // the trough is retained
  })

  it('higher tolerance keeps fewer vertices', () => {
    const price = Array.from({ length: 200 }, (_, i) => Math.exp(Math.sin(i / 5) + i * 0.01))
    const few = vertices(simplifyCurve(price, { smoothSpan: 0, tolerance: 0.08 })).length
    const many = vertices(simplifyCurve(price, { smoothSpan: 0, tolerance: 0.005 })).length
    expect(many).toBeGreaterThan(few)
  })

  it('handles empty and tiny inputs', () => {
    expect(simplifyCurve([], { smoothSpan: 0, tolerance: 0.02 })).toEqual([])
    expect(simplifyCurve([42], { smoothSpan: 0, tolerance: 0.02 })).toEqual([null])
  })
})
