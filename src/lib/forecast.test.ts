import { describe, it, expect } from 'vitest'
import {
  fitParams,
  movingAverage,
  linregress,
  maPoints,
  peakPoints,
  peakValuePoints,
  DAY_MS,
} from './forecast'

// Phase B parity: `fitParams` now fits via the generic `fitCurve` + point
// providers instead of inline loops + `linregress`. This pins the refactor to be
// behaviour-preserving by comparing against a faithful replication of the OLD
// extraction + `linregress` math ("golden"). The real-BTC pixel-identical check
// happens on-device (the price API isn't reachable in this sandbox).

const CLOSE = 1e-9
const expectClose = (a: number, b: number, eps = CLOSE) =>
  expect(Math.abs(a - b)).toBeLessThan(eps + eps * Math.abs(b))

const DZ = Date.UTC(2010, 6, 13)
const START = Date.UTC(2016, 0, 1)

// Synthetic ~8y daily series: power-ish baseline × a slow cycle × small noise.
const times: number[] = []
const prices: number[] = []
for (let d = 0; d < 2920; d++) {
  const t = START + d * DAY_MS
  times.push(t)
  const age = (t - DZ) / DAY_MS
  const base = 1e-5 * Math.pow(age, 3)
  const cycle = 1 + 0.8 * Math.sin(d / 200) // stays > 0
  prices.push(base * cycle * (1 + 0.05 * Math.sin(d)))
}
const ma = movingAverage(prices, 1460)

// Peaks placed on the cycle highs (sin maxima ≈ d 314 / 1571 / 2828) so the
// ratio is positive, plus one beyond the data to exercise the future-skip.
const peaks = [314, 1571, 2828, 3500].map((d) => START + d * DAY_MS)
const lastTime = times[times.length - 1]

/** Faithful replication of the pre-refactor fitParams growth + envelope math. */
function golden(gamma = 0) {
  const xExp: number[] = []
  const yExp: number[] = []
  const xPow: number[] = []
  const yPow: number[] = []
  const wPow: number[] = []
  for (let i = 0; i < times.length; i++) {
    const m = ma[i]
    if (m == null || m <= 0) continue
    const x = (times[i] - DZ) / DAY_MS
    if (x <= 0) continue
    xExp.push(x)
    yExp.push(Math.log(m))
    xPow.push(Math.log(x + 1))
    yPow.push(Math.log(m))
    wPow.push(gamma !== 0 ? Math.pow(x + 1, -gamma) : 1)
  }
  const expFit = linregress(xExp, yExp)
  const powFit = linregress(xPow, yPow, gamma !== 0 ? wPow : undefined)

  const xEnv: number[] = []
  const yEnv: number[] = []
  for (const pd of peaks) {
    if (pd > lastTime) continue
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < times.length; i++) {
      const dd = Math.abs(times[i] - pd)
      if (dd < bd) {
        bd = dd
        bi = i
      }
    }
    if (Math.abs(times[bi] - pd) > 45 * DAY_MS) continue
    const m = ma[bi]
    if (m == null || m <= 0) continue
    const ratio = prices[bi] / m - 1
    if (ratio > 0) {
      xEnv.push((times[bi] - DZ) / DAY_MS)
      yEnv.push(Math.log(ratio))
    }
  }
  const envFit =
    xEnv.length >= 2 ? linregress(xEnv, yEnv) : { slope: -0.000511, intercept: Math.log(48.77) }

  return {
    expConstant: Math.exp(expFit.intercept),
    expExponent: expFit.slope,
    expR2: expFit.r2,
    powConstant: Math.exp(powFit.intercept),
    powExponent: powFit.slope,
    powR2: powFit.r2,
    envConstant: Math.exp(envFit.intercept),
    envExponent: -envFit.slope,
  }
}

describe('fitParams parity after the fitCurve refactor', () => {
  it('matches the pre-refactor extraction + linregress (γ = 0)', () => {
    const p = fitParams(times, prices, ma, DZ, peaks)
    const g = golden(0)
    expectClose(p.expConstant, g.expConstant)
    expectClose(p.expExponent, g.expExponent)
    expectClose(p.expR2, g.expR2)
    expectClose(p.powConstant, g.powConstant)
    expectClose(p.powExponent, g.powExponent)
    expectClose(p.powR2, g.powR2)
    expectClose(p.envConstant, g.envConstant)
    expectClose(p.envExponent, g.envExponent)
  })

  it('honours recency weighting γ on the power fit', () => {
    const p = fitParams(times, prices, ma, DZ, peaks, 0, 1) // powFitGamma = 1
    const g = golden(1)
    expectClose(p.powConstant, g.powConstant)
    expectClose(p.powExponent, g.powExponent)
    expectClose(p.powR2, g.powR2)
  })
})

describe('value-exponential-decay fit (C and λ at a held p)', () => {
  // Closed-form check: ln(ratio) = ln C − λ·MA^p is OLS over (MA^p, ln ratio),
  // so slope = −λ and intercept = ln C. The fit must hold p fixed and solve only
  // C and λ — and move when p changes.
  const goldenVed = (p: number) => {
    const pts = peakValuePoints(times, prices, ma, DZ, peaks, lastTime)
    const fit = linregress(
      pts.xs.map((m) => Math.pow(m, p)),
      pts.ys.map((r) => Math.log(r)),
    )
    return { vedConstant: Math.exp(fit.intercept), vedExponent: -fit.slope }
  }

  it('matches a closed-form log-space OLS at the default p', () => {
    const f = fitParams(times, prices, ma, DZ, peaks) // vedPower defaults to 0.245
    const g = goldenVed(0.245)
    expectClose(f.vedConstant, g.vedConstant)
    expectClose(f.vedExponent, g.vedExponent)
  })

  it('re-fits C and λ when the held p changes', () => {
    const a = fitParams(times, prices, ma, DZ, peaks, 0, 0, undefined, undefined, undefined, 0.5)
    const g = goldenVed(0.5)
    expectClose(a.vedConstant, g.vedConstant)
    expectClose(a.vedExponent, g.vedExponent)
    // A different exponent yields a different fit than the default.
    const base = fitParams(times, prices, ma, DZ, peaks)
    expect(Math.abs(a.vedExponent - base.vedExponent)).toBeGreaterThan(0)
  })
})

describe('point providers', () => {
  it('peakPoints snaps to in-range tops (ratio > 0) and skips future peaks', () => {
    const pts = peakPoints(times, prices, ma, DZ, peaks, lastTime)
    // 3 of the 4 peaks are in range; the 4th (d=3500) is past lastTime.
    expect(pts.xs.length).toBe(3)
    expect(pts.ys.every((r) => r > 0)).toBe(true)
  })

  it('maPoints yields one (age, MA) point per valid in-window sample', () => {
    const pts = maPoints(times, ma, DZ)
    const validMa = ma.filter((m, i) => m != null && m > 0 && (times[i] - DZ) / DAY_MS > 0).length
    expect(pts.xs.length).toBe(validMa)
    expect(pts.xs.length).toBe(pts.ys.length)
  })
})
