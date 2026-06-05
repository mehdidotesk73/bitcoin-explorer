import { describe, it, expect } from 'vitest'
import { fitCurve, type CurveModel } from './fitCurve'
import { linregress } from './forecast'

// Phase A parity: the generic fitter must reproduce, to numerical precision, the
// exact `linregress`-based fits that `fitParams` performs today — for each of the
// three transforms used in forecast.ts. These are the same model specs Phase B
// will wire into `fitParams`, so matching here guarantees end-to-end parity then.

const CLOSE = 1e-9
const expectClose = (a: number, b: number, eps = CLOSE) =>
  expect(Math.abs(a - b)).toBeLessThan(eps + eps * Math.abs(b))

// --- the three forecast models, expressed as CurveModels -------------------
// Growth: ln(MA) = ln C + α·x          (exp)  → features [1, x],        space log
// Growth: ln(MA) = ln C + β·ln(x+1)    (power)→ features [1, ln(x+1)],  space log
// Envelope: ln(ratio) = ln C − λ·x            → features [1, x],        space log,
//           with the decay rate read off as −slope.

const expGrowth: CurveModel<{ constant: number; exponent: number }> = {
  features: (x) => [1, x],
  rebuild: (c) => ({ constant: Math.exp(c[0]), exponent: c[1] }),
}
const powGrowth: CurveModel<{ constant: number; exponent: number }> = {
  features: (x) => [1, Math.log(x + 1)],
  rebuild: (c) => ({ constant: Math.exp(c[0]), exponent: c[1] }),
}
const envelope: CurveModel<{ constant: number; exponent: number }> = {
  features: (x) => [1, x],
  rebuild: (c) => ({ constant: Math.exp(c[0]), exponent: -c[1] }),
}

// Synthetic but realistic: an exponential-ish MA over ~6 years of "days", and a
// decaying overshoot ratio sampled at a handful of "cycle tops".
const xs: number[] = []
const ma: number[] = []
for (let d = 1; d <= 2200; d += 7) {
  xs.push(d)
  ma.push(120 * Math.exp(0.0017 * d) * (1 + 0.05 * Math.sin(d / 90))) // wobble so r2 < 1
}
const peakX = [310, 760, 1240, 1700, 2150]
const peakRatio = peakX.map((d) => 6 * Math.exp(-0.0011 * d) + 0.02) // ratio = price/MA − 1

describe('fitCurve parity with linregress (the engine fitParams uses)', () => {
  it('exp-growth: matches linregress(x, ln MA) and maps C = exp(intercept)', () => {
    const ref = linregress(xs, ma.map(Math.log))
    const got = fitCurve(xs, ma, expGrowth, { space: 'log' })
    expectClose(got.coeffs[0], ref.intercept)
    expectClose(got.coeffs[1], ref.slope)
    expectClose(got.metrics.r2, ref.r2)
    expectClose(got.params.constant, Math.exp(ref.intercept))
    expectClose(got.params.exponent, ref.slope)
  })

  it('power-growth: matches weighted linregress(ln(x+1), ln MA)', () => {
    const lx = xs.map((x) => Math.log(x + 1))
    const w = xs.map((x) => Math.pow(x + 1, -1)) // γ = 1 recency weighting
    const ref = linregress(lx, ma.map(Math.log), w)
    const got = fitCurve(xs, ma, powGrowth, { space: 'log', weights: w })
    expectClose(got.coeffs[0], ref.intercept)
    expectClose(got.coeffs[1], ref.slope)
    expectClose(got.metrics.r2, ref.r2)
    expectClose(got.params.constant, Math.exp(ref.intercept))
  })

  it('envelope: matches linregress(x, ln ratio) with λ = −slope', () => {
    const ref = linregress(peakX, peakRatio.map(Math.log))
    const got = fitCurve(peakX, peakRatio, envelope, { space: 'log' })
    expectClose(got.coeffs[1], ref.slope)
    expectClose(got.params.constant, Math.exp(ref.intercept))
    expectClose(got.params.exponent, -ref.slope)
  })

  it('eval reconstructs the fitted quantity in natural units', () => {
    const got = fitCurve(xs, ma, expGrowth, { space: 'log' })
    // eval(x) should equal C·exp(α·x) at any x.
    for (const x of [5, 500, 2000, 3000]) {
      expectClose(got.eval(x), got.params.constant * Math.exp(got.params.exponent * x))
    }
  })

  it('linear space matches plain linregress (no transform)', () => {
    const ys = xs.map((x) => 3 * x + 17)
    const ref = linregress(xs, ys)
    const got = fitCurve(xs, ys, expGrowth, { space: 'linear' })
    expectClose(got.coeffs[0], ref.intercept)
    expectClose(got.coeffs[1], ref.slope)
    expectClose(got.metrics.r2, ref.r2, 1e-6)
  })
})
