import { describe, it, expect } from 'vitest'
import { simplifyCurve } from './simplify'

/** Indices of the kept (non-null) vertices. */
const vertices = (out: (number | null)[]) =>
  out.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0)

describe('simplifyCurve', () => {
  it('returns a same-length array', () => {
    const price = [1, 2, 3, 4, 5]
    expect(simplifyCurve(price, { minMovePct: 10 }).length).toBe(price.length)
  })

  it('reduces a monotonic line to its two endpoints', () => {
    // exp() so log-price is a straight line → RDP keeps only the ends.
    const price = Array.from({ length: 50 }, (_, i) => Math.exp(i * 0.1))
    expect(vertices(simplifyCurve(price, { minMovePct: 10 }))).toEqual([0, 49])
  })

  it('keeps the turning point of a V shape, on the true extremum', () => {
    const down = Array.from({ length: 25 }, (_, i) => Math.exp((24 - i) * 0.1))
    const up = Array.from({ length: 25 }, (_, i) => Math.exp((i + 1) * 0.1))
    const price = [...down, ...up] // trough at index 24
    const out = simplifyCurve(price, { minMovePct: 10 })
    const v = vertices(out)
    expect(v[0]).toBe(0)
    expect(v[v.length - 1]).toBe(price.length - 1)
    expect(v).toContain(24)
    expect(out[24]).toBe(price[24]) // vertex sits on the real price, not smoothed
  })

  it('a larger min-move keeps fewer vertices', () => {
    const price = Array.from({ length: 200 }, (_, i) => Math.exp(Math.sin(i / 5) + i * 0.01))
    const few = vertices(simplifyCurve(price, { minMovePct: 30 })).length
    const many = vertices(simplifyCurve(price, { minMovePct: 2 })).length
    expect(many).toBeGreaterThan(few)
  })

  it('handles empty and tiny inputs', () => {
    expect(simplifyCurve([], { minMovePct: 10 })).toEqual([])
    expect(simplifyCurve([42], { minMovePct: 10 })).toEqual([null])
  })
})
