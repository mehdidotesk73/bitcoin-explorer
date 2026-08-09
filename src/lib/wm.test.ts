import { describe, it, expect } from 'vitest'
import { turningPoints, detectWM } from './wm'

/** Linear ramp from `from` to `to` over `days` steps (exclusive of `from`). */
const ramp = (from: number, to: number, days: number) =>
  Array.from({ length: days }, (_, i) => from + ((to - from) * (i + 1)) / days)

describe('turningPoints (ZigZag on b)', () => {
  it('extracts alternating troughs and peaks above the prominence floor', () => {
    const b = [0, ...ramp(0, -1, 10), ...ramp(-1, 1, 10), ...ramp(1, 0, 10)]
    const tp = turningPoints(b, 0.5)
    expect(tp.map((t) => t.kind)).toEqual(['trough', 'peak'])
    expect(tp[0].b).toBeCloseTo(-1, 5)
    expect(tp[1].b).toBeCloseTo(1, 5)
  })

  it('ignores wiggles below the prominence floor', () => {
    const b = [0, 0.1, -0.1, 0.1, -0.1, 0.1] // tiny noise
    expect(turningPoints(b, 0.5)).toHaveLength(0)
  })
})

describe('detectWM', () => {
  const params = { minProminence: 0.4, tol: 0.3, threshold: 0.5 }

  it('flags a textbook W (lower band → above MA → MA higher-low → breakout)', () => {
    const b = [
      0,
      ...ramp(0, -1, 10), // trough 1 at the lower band
      ...ramp(-1, 0.6, 12), // peak above the MA
      ...ramp(0.6, 0.05, 10), // trough 2 hugging the MA from above (higher low)
      ...ramp(0.05, 0.7, 10), // breakout
    ]
    const ms = detectWM(b, params)
    const w = ms.find((m) => m.type === 'W')
    expect(w).toBeTruthy()
    expect(w!.confidence).toBeGreaterThan(0.8)
    expect(ms.some((m) => m.type === 'M')).toBe(false)
  })

  it('flags a textbook M (mirror of the W)', () => {
    const b = [
      0,
      ...ramp(0, 1, 10), // peak 1 at the upper band
      ...ramp(1, -0.6, 12), // valley below the MA
      ...ramp(-0.6, -0.05, 10), // peak 2 hugging the MA from below (lower high)
      ...ramp(-0.05, -0.7, 10), // breakdown
    ]
    const ms = detectWM(b, params)
    const m = ms.find((x) => x.type === 'M')
    expect(m).toBeTruthy()
    expect(m!.confidence).toBeGreaterThan(0.8)
    expect(ms.some((x) => x.type === 'W')).toBe(false)
  })

  it('rejects a shape whose second bottom never returns to the MA', () => {
    // second trough stays deep (≈ −0.9) → not a higher-low-at-MA W
    const b = [
      0,
      ...ramp(0, -1, 10),
      ...ramp(-1, 0.6, 12),
      ...ramp(0.6, -0.9, 10),
      ...ramp(-0.9, 0.5, 10),
    ]
    expect(detectWM(b, params).some((m) => m.type === 'W')).toBe(false)
  })

  it('confidence drops as the first bottom falls short of the band', () => {
    const mk = (firstLow: number) =>
      detectWM(
        [
          0,
          ...ramp(0, firstLow, 10),
          ...ramp(firstLow, 0.6, 12),
          ...ramp(0.6, 0.05, 10),
          ...ramp(0.05, 0.7, 10),
        ],
        { minProminence: 0.4, tol: 0.5, threshold: 0 },
      ).find((m) => m.type === 'W')!.confidence
    expect(mk(-1)).toBeGreaterThan(mk(-0.7))
  })
})
