import { describe, it, expect } from 'vitest'
import { sma, ema, bollinger, bandPosition } from './indicators'

describe('sma', () => {
  it('is null until warm-up, then the rolling mean', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
  })
})

describe('ema', () => {
  it('is the identity at span 0 (no smoothing)', () => {
    expect(ema([10, 20, 30], 0)).toEqual([10, 20, 30])
  })
  it('holds a constant series constant', () => {
    expect(ema([5, 5, 5, 5], 10)).toEqual([5, 5, 5, 5])
  })
})

describe('bollinger', () => {
  it('collapses the bands to the mean when σ = 0', () => {
    const b = bollinger([5, 5, 5, 5], 2, 2)
    expect(b.middle).toEqual([null, 5, 5, 5])
    expect(b.upper).toEqual([null, 5, 5, 5])
    expect(b.lower).toEqual([null, 5, 5, 5])
  })
})

describe('bandPosition', () => {
  it('is centered: +1 sits on the +kσ band', () => {
    // window [10,20]: mean 15, σ 5, k=1 → (20−15)/5 = 1
    expect(bandPosition([10, 10, 20], 0, 2, 1)).toEqual([null, null, 1])
  })

  it('is causal — a future price never changes an earlier value', () => {
    const price = [10, 11, 12, 13, 14, 15]
    const before = bandPosition(price, 0, 3, 1)
    const mutated = [...price]
    mutated[5] = 9999 // change only the last day
    const after = bandPosition(mutated, 0, 3, 1)
    // Every value at indices < 5 must be untouched.
    for (let i = 0; i < 5; i++) expect(after[i]).toEqual(before[i])
  })
})
