// Offline verification harness for the multi-scale M/W heat (spec §6.4, §11.4).
// Run: npx tsx scripts/mwheat-verify.mjs   (or build then node)
// Uses synthetic data only — no live API needed.

import { mwHeat, DEFAULT_MW_PARAMS } from '../src/lib/mwheat.ts'

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}  ${detail}`)
  }
}

const P = { ...DEFAULT_MW_PARAMS }
// Use smaller N so synthetic series of a few hundred days exercise all horizons.
const params = { ...P, N: 10 }

// --- Synthetic generators ---------------------------------------------------
function syntheticM(level = 100, span = 240, amp = 0.4) {
  // Two humps above a baseline, second lower: an idealised M in price space.
  const out = []
  for (let i = 0; i < span; i++) {
    const x = i / span
    // baseline + first hump (centre .3) + smaller second hump (centre .7)
    const h1 = Math.exp(-(((x - 0.3) / 0.1) ** 2))
    const h2 = 0.6 * Math.exp(-(((x - 0.7) / 0.1) ** 2))
    out.push(level * (1 + amp * (h1 + h2) - amp * 0.5))
  }
  return out
}
function mirror(series, level = 100) {
  // Vertical mirror about the series mean (turns an M into a W).
  const m = series.reduce((a, v) => a + v, 0) / series.length
  return series.map((v) => 2 * m - v)
}
function randomWalk(n = 600, seed = 1, drift = 0) {
  let s = seed
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const out = [100]
  for (let i = 1; i < n; i++) out.push(Math.max(1, out[i - 1] * (1 + drift + (rnd() - 0.5) * 0.04)))
  return out
}

// --- §6.4 / §11.4 Causality: H[t] on P[:t] == H[t] on P[:t+50] --------------
{
  const base = randomWalk(400, 7, 0.001)
  const full = mwHeat(base, params).heat
  const cut = 300
  const truncated = mwHeat(base.slice(0, cut), params).heat
  let maxDrift = 0
  for (let t = 0; t < cut; t++) maxDrift = Math.max(maxDrift, Math.abs(full[t] - truncated[t]))
  ok('causality: no future leakage (drift < 1e-9)', maxDrift < 1e-9, `maxDrift=${maxDrift}`)
}

// --- §11.4 Symmetry: mirroring the shape flips the sign at the extremum ------
// Note: an exact pointwise sign-flip is not expected — the trend operator uses
// log(P_s) (for scale-invariance) while the bands are arithmetic, so price
// mirroring isn't an exact symmetry of the whole pipeline. The defensible
// property is polarity at the point of strongest signal: an M peaks positive and
// its mirror troughs negative at the corresponding extremum.
{
  const pre = randomWalk(150, 3)
  const m = syntheticM(pre[pre.length - 1])
  const hM = mwHeat([...pre, ...m], params).heat
  const hW = mwHeat([...pre, ...mirror(m, pre[pre.length - 1])], params).heat
  const peakM = Math.max(...hM.slice(pre.length))
  const troughW = Math.min(...hW.slice(pre.length))
  ok('symmetry: M shape peaks positive', peakM > 0.2, `peakM=${peakM.toFixed(2)}`)
  ok('symmetry: mirrored shape troughs negative', troughW < -0.2, `troughW=${troughW.toFixed(2)}`)
}

// --- §11.4 Scale invariance: same shape at $6k and $110k → similar peak ------
{
  const pre = randomWalk(150, 5)
  const lowM = [...pre.map((v) => v * 60), ...syntheticM(pre[pre.length - 1] * 60)]
  const hiM = [...pre.map((v) => v * 1100), ...syntheticM(pre[pre.length - 1] * 1100)]
  const peakLow = Math.max(...mwHeat(lowM, params).heat)
  const peakHi = Math.max(...mwHeat(hiM, params).heat)
  ok(
    'scale invariance: peak heat within 0.1 across price eras',
    Math.abs(peakLow - peakHi) < 0.1,
    `low=${peakLow.toFixed(3)} hi=${peakHi.toFixed(3)}`,
  )
}

// --- §11.4 Null test: random walk → heat centred near 0 ---------------------
{
  const rw = randomWalk(800, 11, 0)
  const h = mwHeat(rw, params).heat
  const mean = h.reduce((a, v) => a + v, 0) / h.length
  ok(
    'null: random-walk mean heat near 0 (|mean| < 0.15)',
    Math.abs(mean) < 0.15,
    `mean=${mean.toFixed(3)}`,
  )
}

// --- §11.4 Synthetic ladder: ideal M positive, ideal W negative -------------
{
  const pre = randomWalk(150, 13)
  const idealM = [...pre, ...syntheticM(pre[pre.length - 1])]
  const idealW = [...pre, ...mirror(syntheticM(pre[pre.length - 1]), pre[pre.length - 1])]
  const peakM = Math.max(...mwHeat(idealM, params).heat)
  const troughW = Math.min(...mwHeat(idealW, params).heat)
  ok('ladder: ideal M reaches strong positive (> 0.3)', peakM > 0.3, `peakM=${peakM.toFixed(3)}`)
  ok(
    'ladder: ideal W reaches strong negative (< −0.3)',
    troughW < -0.3,
    `troughW=${troughW.toFixed(3)}`,
  )
}

// --- Three-down-run W (the spec'd run-template) → strong negative heat -------
// Build a price series whose b-trace is DR1(below) UR1 DR2(cross) UR2 DR3(above)
// UR3, i.e. the exact "two troughs in the lower band" W (see wpattern-example).
{
  const ramp = (from, to, days) =>
    Array.from({ length: days }, (_, i) => from + ((to - from) * (i + 1)) / days)
  // b-trace legs (monotone runs ⇒ ~100% sustained in-direction).
  const bTrace = [
    -0.2,
    ...ramp(-0.2, -1.0, 12), // DR1: into lower band (trough 1)
    ...ramp(-1.0, 0.8, 14), //  UR1
    ...ramp(0.8, -0.9, 16), //  DR2: cross upper→lower (trough 2)
    ...ramp(-0.9, 0.7, 14), //  UR2
    ...ramp(0.7, 0.2, 8), //    DR3: shallow, above MA
    ...ramp(0.2, 1.1, 10), //   UR3: breakout
  ]
  // Realise as price; flat MA ≈ 100 so engine-b tracks the designed b-trace.
  const pre = randomWalk(120, 23)
  const base = pre[pre.length - 1]
  const wPrice = [...pre, ...bTrace.map((bv) => base * (1 + 0.08 * bv))]
  const res = mwHeat(wPrice, params)
  const region = res.heat.slice(pre.length)
  const troughW = Math.min(...region)
  // And the daily lens (the comparable scale for ~75-day legs) should see it.
  const daily = res.horizons.find((h) => h.horizon === 'daily')
  const dailyTrough = Math.min(...daily.heat.slice(pre.length))
  ok(
    'run-template: spec W reaches strong negative (< −0.3)',
    troughW < -0.3,
    `troughW=${troughW.toFixed(3)}`,
  )
  ok(
    'run-template: daily lens fires on the W (< −0.3)',
    dailyTrough < -0.3,
    `dailyTrough=${dailyTrough.toFixed(3)}`,
  )
}

// --- Off-centre W: a W that breaks out must NOT read as M (no band inversion) -
// A double bottom forming inside an uptrend keeps its troughs above the MA. The
// detector must still call it a W (negative) at/through the breakout, not invert
// to M (positive) because the pattern sits in the upper band.
{
  const legs = []
  const push = (n, d) => {
    for (let k = 0; k < n; k++) legs.push(d)
  }
  push(80, 0.006) // prior uptrend → MA lags below price (troughs stay above MA)
  push(18, -0.004)
  push(16, 0.008) // dip 1 + recover
  push(20, -0.004)
  push(16, 0.008) // dip 2 + recover (double bottom)
  push(40, 0.007) // breakout / markup
  let p = 100
  const px = [p]
  for (const d of legs) {
    p *= 1 + d
    px.push(p)
  }
  const wk = mwHeat(px, params).horizons.find((h) => h.horizon === 'weekly')
  // The markup after the second trough (last ~30 bars) is the breakout region.
  const region = wk.heat.slice(px.length - 30).filter(Number.isFinite)
  const maxHeat = Math.max(...region)
  ok(
    'off-centre W: breakout never inverts to M (max heat < 0.05)',
    maxHeat < 0.05,
    `maxHeat=${maxHeat.toFixed(3)}`,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
