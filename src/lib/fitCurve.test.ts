import { describe, it, expect } from 'vitest'
import { fitCurve, fitEnsemble } from './fitCurve'
import { linregress, expGrowthModel, powGrowthModel, envelopeModel } from './forecast'

// Phase A parity: the generic fitter must reproduce, to numerical precision, the
// exact `linregress`-based fits that `fitParams` performs today — for each of the
// three transforms used in forecast.ts. We use the very model specs Phase B
// wires into `fitParams`, so matching here pins the engine end-to-end.

const CLOSE = 1e-9
const expectClose = (a: number, b: number, eps = CLOSE) =>
  expect(Math.abs(a - b)).toBeLessThan(eps + eps * Math.abs(b))

// The three forecast models (imported, not redefined):
//   exp growth   ln(MA)    = ln C + α·x         features [1, x],        space log
//   power growth ln(MA)    = ln C + β·ln(x+1)   features [1, ln(x+1)],  space log
//   envelope     ln(ratio) = ln C − λ·x         features [1, x],        space log
const expGrowth = expGrowthModel
const powGrowth = powGrowthModel
const envelope = envelopeModel

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

describe('fitEnsemble — Phase C resampling', () => {
  const sortedAtX = (band: number[][], col: number) => band.map((row) => row[col])

  it('residual-block: B members, seed-reproducible, band brackets the base fit', () => {
    const rs = { kind: 'residual-block', blockLen: 13, B: 200, seed: 42 } as const
    const a = fitEnsemble(xs, ma, expGrowth, rs, { space: 'log' })
    const b = fitEnsemble(xs, ma, expGrowth, rs, { space: 'log' })
    expect(a.members.length).toBe(200)
    // Same seed → identical ensemble (deterministic).
    expectClose(a.members[0].params.exponent, b.members[0].params.exponent)

    const gx = [100, 1000, 2100]
    const band = a.bandAt(gx, [10, 50, 90])
    for (let c = 0; c < gx.length; c++) {
      const [lo, mid, hi] = sortedAtX(band, c)
      expect(lo).toBeLessThanOrEqual(mid)
      expect(mid).toBeLessThanOrEqual(hi)
      // The unperturbed fit sits inside the 10–90 band.
      const baseY = a.base.eval(gx[c])
      expect(baseY).toBeGreaterThanOrEqual(lo)
      expect(baseY).toBeLessThanOrEqual(hi)
    }
  })

  it('jackknife: one leave-one-out member per cycle top', () => {
    const e = fitEnsemble(peakX, peakRatio, envelope, { kind: 'jackknife' }, { space: 'log' })
    expect(e.members.length).toBe(peakX.length)
    // Dropping a clean point barely moves the fit; band stays tight but ordered.
    const band = e.bandAt([1000], [5, 95])
    expect(band[0][0]).toBeLessThanOrEqual(band[1][0])
  })

  it('cases: resamples whole points and skips degenerate draws', () => {
    const e = fitEnsemble(
      peakX,
      peakRatio,
      envelope,
      { kind: 'cases', B: 300, seed: 7 },
      { space: 'log' },
    )
    // Most draws are non-degenerate (≥ 2 distinct of 5), so we keep plenty.
    expect(e.members.length).toBeGreaterThan(250)
    expect(e.members.length).toBeLessThanOrEqual(300)
  })

  it('perf checkpoint: B=1000 full-history refits stay near-instant', () => {
    // ~4000 daily points — the full-history scale the plan budgets for.
    const bx: number[] = []
    const by: number[] = []
    for (let d = 1; d <= 4000; d++) {
      bx.push(d)
      by.push(100 * Math.exp(0.0016 * d) * (1 + 0.04 * Math.sin(d / 80)))
    }
    const t0 = performance.now()
    const e = fitEnsemble(
      bx,
      by,
      expGrowth,
      { kind: 'residual-block', blockLen: 30, B: 1000, seed: 1 },
      { space: 'log' },
    )
    const ms = performance.now() - t0
    expect(e.members.length).toBe(1000)
    // Generous CI-safe bound; locally this is well under a second.
    expect(ms).toBeLessThan(5000)
  })
})
