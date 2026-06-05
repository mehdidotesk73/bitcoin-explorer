// Bitcoin "price mechanics" forecast engine.
//
// Implements the model spec'd in docs/system-design.md §5.2:
//
//   projected_price = model_ma  ×  model_price_over_ma
//
//   model_ma            — the value baseline: a 4-year moving average,
//                         extrapolated forward by a growth model.
//   model_price_over_ma — the volatility multiplier: a decaying envelope,
//                         optionally modulated by cycle-top peaks.
//
// Every "automatic" calibration here reduces to ordinary least-squares in
// log-space, so it runs instantly in the browser with no optimizer.

import { fitCurve, type CurveModel } from './fitCurve'

export const DAY_MS = 86_400_000
export const DEFAULT_DAY_ZERO = '2010-07-13'
export const DEFAULT_MA_WINDOW = 1460 // 4 years

// Historical cycle tops (used to calibrate the envelope and place peaks) plus
// projected future tops on the ~4-year halving rhythm.
export const DEFAULT_PEAK_DATES = [
  '2013-11-28',
  '2017-12-17',
  '2021-03-17',
  '2025-07-13',
  '2029-07-12',
  '2033-01-28',
  '2039-09-24',
]
export const DEFAULT_PEAK_SPREAD = 0.008
// Value-exponential-decay envelope: the shape exponent p in ratio = C·e^(−λ·MA^p).
// Held fixed (user-set) during the fit so only C and λ are solved — keeps it a
// closed-form log-space OLS. See vedModel / fitParams.
export const DEFAULT_VED_POWER = 0.245
// Linear growth: take the Nth-percentile of the trailing MA slopes.
//   slopeRangeDays  — how far back to gather slope samples (0 = all history).
//   slopeWindowDays — the span each individual slope is measured over
//                     (daily/weekly/monthly/yearly preset).
// e.g. "20th percentile of the past 4 years' weekly slopes".
export const DEFAULT_SLOPE_RANGE_DAYS = 1460 // ~4 years
export const DEFAULT_SLOPE_WINDOW_DAYS = 7 // weekly
export const DEFAULT_SLOPE_PERCENTILE = 50

export type GrowthType = 'exponential' | 'power' | 'linear'
export type EnvelopeType =
  | 'exponential-decay'
  | 'value-power-decay'
  | 'value-exponential-decay'
  | 'constant'
export type DistributionType = 'peaks' | 'none'

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const daysSince = (ms: number, zeroMs: number) => (ms - zeroMs) / DAY_MS

export interface LinFit {
  slope: number
  intercept: number
  r2: number
}

/** Ordinary least-squares fit of y = slope·x + intercept, with R². */
export function linregress(xs: number[], ys: number[], weights?: number[]): LinFit {
  const n = xs.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 }
  let sw = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1
    sw += w
    sx += w * xs[i]
    sy += w * ys[i]
    sxx += w * xs[i] * xs[i]
    sxy += w * xs[i] * ys[i]
  }
  const denom = sw * sxx - sx * sx
  const slope = denom === 0 ? 0 : (sw * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / sw
  const meanY = sy / sw
  let ssTot = 0,
    ssRes = 0
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1
    const pred = slope * xs[i] + intercept
    ssRes += w * (ys[i] - pred) ** 2
    ssTot += w * (ys[i] - meanY) ** 2
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

/** Index of the sample whose time is closest to `target` (binary search). */
function nearestIndex(times: number[], target: number): number {
  const hi0 = times.length - 1
  if (hi0 < 0) return -1
  if (target <= times[0]) return 0
  if (target >= times[hi0]) return hi0
  let lo = 0,
    hi = hi0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] === target) return mid
    if (times[mid] < target) lo = mid + 1
    else hi = mid - 1
  }
  return target - times[hi] <= times[lo] - target ? hi : lo
}

const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// ---------------------------------------------------------------------------
// Value baseline: trailing moving average
// ---------------------------------------------------------------------------

/**
 * Trailing `window`-sample mean of `prices`. Early entries (before a full
 * window exists) use the partial mean so the baseline is defined from day one.
 */
export function movingAverage(prices: number[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(prices.length).fill(null)
  if (window <= 0) return out
  let sum = 0
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i]
    if (i >= window) sum -= prices[i - window]
    const count = Math.min(i + 1, window)
    out[i] = sum / count
  }
  return out
}

// ---------------------------------------------------------------------------
// Automatic calibration (all in log-space → closed-form OLS)
// ---------------------------------------------------------------------------

export interface FittedParams {
  expConstant: number
  expExponent: number
  expR2: number
  powConstant: number
  powExponent: number
  powR2: number
  envConstant: number
  envExponent: number
  vedConstant: number // value-exponential-decay C, fit at the held p
  vedExponent: number // value-exponential-decay λ, fit at the held p
  linRate: number // chosen-percentile trailing MA slope (per day)
}

/**
 * Linear-interpolated `p`-th percentile (0–100) of `sorted` (ascending).
 * Returns 0 for an empty input.
 */
export function percentile(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0]
  const clamped = Math.min(100, Math.max(0, p))
  const rank = (clamped / 100) * (n - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

/** Rolling slope of `ma` over a trailing `windowDays` window, per sample. */
function rollingSlopes(times: number[], ma: (number | null)[], windowDays: number): number[] {
  const out: number[] = new Array(times.length).fill(NaN)
  const span = windowDays * DAY_MS
  for (let i = 0; i < times.length; i++) {
    const minTime = times[i] - span
    const xs: number[] = []
    const ys: number[] = []
    for (let j = i; j >= 0 && times[j] >= minTime; j--) {
      const m = ma[j]
      if (m == null) continue
      xs.push((times[j] - times[i]) / DAY_MS)
      ys.push(m)
    }
    if (xs.length >= 2) out[i] = linregress(xs, ys).slope
  }
  return out
}

// ---------------------------------------------------------------------------
// Curve models + point providers (shared by fitParams and, later, the
// uncertainty bands). Each model is linear-in-features after a log transform, so
// fitCurve solves it as closed-form weighted OLS — the same math as the
// linregress fits these replaced. Point selection lives in the providers, kept
// separate from the fitter so a richer peak detector can drop in later.
// ---------------------------------------------------------------------------

interface GrowthParams {
  constant: number
  exponent: number
}

/** ln(MA) = ln C + α·x  →  MA = C·e^(α·x). */
export const expGrowthModel: CurveModel<GrowthParams> = {
  features: (x) => [1, x],
  rebuild: (c) => ({ constant: Math.exp(c[0]), exponent: c[1] }),
}

/** ln(MA) = ln C + β·ln(x+1)  →  MA = C·(x+1)^β. */
export const powGrowthModel: CurveModel<GrowthParams> = {
  features: (x) => [1, Math.log(x + 1)],
  rebuild: (c) => ({ constant: Math.exp(c[0]), exponent: c[1] }),
}

/** ln(ratio) = ln C − λ·x  →  ratio = C·e^(−λx); the decay λ is read as −slope. */
export const envelopeModel: CurveModel<GrowthParams> = {
  features: (x) => [1, x],
  rebuild: (c) => ({ constant: Math.exp(c[0]), exponent: -c[1] }),
}

/**
 * Value-exponential-decay envelope, regressed against the MA value (not time):
 * ln(ratio) = ln C − λ·MA^p. The shape exponent `p` is held fixed, so the model
 * stays linear in features `[1, MA^p]` — a closed-form log-space OLS that solves
 * only C and λ. Pass the current `p`; re-fit with a new one to move the exponent.
 */
export const vedModel = (p: number): CurveModel<GrowthParams> => ({
  features: (ma) => [1, Math.pow(ma, p)],
  rebuild: (c) => ({ constant: Math.exp(c[0]), exponent: -c[1] }),
})

/**
 * Value-curve points: every valid MA sample inside the calibration window, as
 * (daysSince(t), MA). Both growth models fit these same points.
 */
export function maPoints(
  times: number[],
  ma: (number | null)[],
  dayZeroMs: number,
  fitCutoff = -Infinity,
): { xs: number[]; ys: number[] } {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < times.length; i++) {
    const m = ma[i]
    if (m == null || m <= 0) continue
    if (times[i] < fitCutoff) continue
    const x = daysSince(times[i], dayZeroMs)
    if (x <= 0) continue
    xs.push(x)
    ys.push(m)
  }
  return { xs, ys }
}

/**
 * Observable cycle tops: each peak date snapped to its nearest sample (within
 * `snapDays`, MA > 0, ratio > 0), as { days, ma, ratio }. This is the
 * hand-picked-dates selection — swappable later for a data-driven peak detector
 * without touching the fitter. The two `peak*Points` providers below project it
 * onto whichever independent variable a given envelope model regresses against.
 */
function peakSamples(
  times: number[],
  prices: number[],
  ma: (number | null)[],
  dayZeroMs: number,
  peakDatesMs: number[],
  lastTime: number,
  snapDays = 45,
): { days: number; ma: number; ratio: number }[] {
  const out: { days: number; ma: number; ratio: number }[] = []
  for (const pd of peakDatesMs) {
    if (pd > lastTime) continue // future top: not observable yet
    const i = nearestIndex(times, pd)
    if (i < 0) continue
    if (Math.abs(times[i] - pd) > snapDays * DAY_MS) continue
    const m = ma[i]
    if (m == null || m <= 0) continue
    const ratio = prices[i] / m - 1
    if (ratio > 0) out.push({ days: daysSince(times[i], dayZeroMs), ma: m, ratio })
  }
  return out
}

/** Envelope points keyed by time: (daysSince(t), ratio). Feeds time-based models. */
export function peakPoints(
  times: number[],
  prices: number[],
  ma: (number | null)[],
  dayZeroMs: number,
  peakDatesMs: number[],
  lastTime: number,
  snapDays = 45,
): { xs: number[]; ys: number[] } {
  const s = peakSamples(times, prices, ma, dayZeroMs, peakDatesMs, lastTime, snapDays)
  return { xs: s.map((p) => p.days), ys: s.map((p) => p.ratio) }
}

/** Envelope points keyed by MA value: (MA, ratio). Feeds the value-based models. */
export function peakValuePoints(
  times: number[],
  prices: number[],
  ma: (number | null)[],
  dayZeroMs: number,
  peakDatesMs: number[],
  lastTime: number,
  snapDays = 45,
): { xs: number[]; ys: number[] } {
  const s = peakSamples(times, prices, ma, dayZeroMs, peakDatesMs, lastTime, snapDays)
  return { xs: s.map((p) => p.ma), ys: s.map((p) => p.ratio) }
}

/**
 * Fit growth + envelope parameters to the loaded history. Growth fits use the
 * valid MA points within the last `fitWindowDays` of data (0 = all history);
 * the envelope is fit only to the price/MA ratio observed on historical
 * cycle-top days (those within the data span).
 */
export function fitParams(
  times: number[],
  prices: number[],
  ma: (number | null)[],
  dayZeroMs: number,
  peakDatesMs: number[],
  fitWindowDays = 0,
  powFitGamma = 0,
  slopeRangeDays = DEFAULT_SLOPE_RANGE_DAYS,
  slopeWindowDays = DEFAULT_SLOPE_WINDOW_DAYS,
  slopePercentile = DEFAULT_SLOPE_PERCENTILE,
  vedPower = DEFAULT_VED_POWER,
): FittedParams {
  const lastTime = times[times.length - 1] ?? 0
  const fitCutoff = fitWindowDays > 0 ? lastTime - fitWindowDays * DAY_MS : -Infinity

  // Growth: both baselines fit ln(MA) over the same calibration-window MA points
  // (maPoints); they differ only in the model's features and the power fit's
  // recency weighting.
  const gPts = maPoints(times, ma, dayZeroMs, fitCutoff)
  const expFit = fitCurve(gPts.xs, gPts.ys, expGrowthModel, { space: 'log' })
  // Daily samples are uniform in x but the power fit regresses on ln(x+1), so
  // recent years are exponentially over-represented. Weighting each point by
  // (x+1)^(−γ) counteracts that: γ=0 is plain per-sample OLS, γ=1 gives equal
  // weight per log-time decade (lets early cycles steepen the slope).
  const wPow = powFitGamma !== 0 ? gPts.xs.map((x) => Math.pow(x + 1, -powFitGamma)) : undefined
  const powFit = fitCurve(gPts.xs, gPts.ys, powGrowthModel, { space: 'log', weights: wPow })

  // Envelope: at a cycle top, price/MA ≈ envelope, so price/MA − 1 ≈ C·e^(−λx).
  // Fit ln(ratio) over the observable tops; fall back to the prior hand-picked
  // constants when fewer than two tops are in range.
  const envPts = peakPoints(times, prices, ma, dayZeroMs, peakDatesMs, lastTime)
  let envConstant = 48.77
  let envExponent = 0.000511
  if (envPts.xs.length >= 2) {
    const envFit = fitCurve(envPts.xs, envPts.ys, envelopeModel, { space: 'log' })
    envConstant = envFit.params.constant
    envExponent = envFit.params.exponent
  }

  // Value-exponential-decay envelope: the same tops, regressed against MA value.
  // p is held fixed (vedPower), so vedModel(p) is linear in [1, MA^p] and the fit
  // solves only C and λ in closed form. Re-fitting with a changed p moves the
  // exponent. Same observable-tops fallback as the time-based envelope above.
  const vedPts = peakValuePoints(times, prices, ma, dayZeroMs, peakDatesMs, lastTime)
  let vedConstant = 50
  let vedExponent = 0.245
  if (vedPts.xs.length >= 2) {
    const vedFit = fitCurve(vedPts.xs, vedPts.ys, vedModel(vedPower), { space: 'log' })
    vedConstant = vedFit.params.constant
    vedExponent = vedFit.params.exponent
  }

  // Linear rate: the chosen percentile of the trailing MA slopes. Each slope is
  // measured over a `slopeWindowDays` window (daily/weekly/monthly/yearly), and
  // samples are gathered across the last `slopeRangeDays` of history (0 = all).
  // A short window relative to the very smooth 4yr MA gives the slope
  // distribution real spread, so the percentile meaningfully changes the rate.
  const slopeCutoff = slopeRangeDays > 0 ? lastTime - slopeRangeDays * DAY_MS : -Infinity
  const slopes = rollingSlopes(times, ma, Math.max(slopeWindowDays, 2))
    .filter((s, i) => Number.isFinite(s) && times[i] >= slopeCutoff)
    .sort((a, b) => a - b)
  const linRate = percentile(slopes, slopePercentile)

  return {
    expConstant: expFit.params.constant,
    expExponent: expFit.params.exponent,
    expR2: expFit.metrics.r2,
    powConstant: powFit.params.constant,
    powExponent: powFit.params.exponent,
    powR2: powFit.metrics.r2,
    envConstant,
    envExponent,
    vedConstant,
    vedExponent,
    linRate,
  }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface ForecastConfig {
  dayZeroMs: number
  growthType: GrowthType
  expConstant: number
  expExponent: number
  powConstant: number
  powExponent: number
  linRate: number // per-day MA growth for the linear model
  envelopeType: EnvelopeType
  envConstant: number
  envExponent: number
  vpdConstant: number
  vpdPower: number
  vedConstant: number
  vedExponent: number
  vedPower: number
  constValue: number
  distributionType: DistributionType
  peakDatesMs: number[]
  peakSpread: number
  horizonMs: number
  resolutionDays: number
}

export interface ForecastResult {
  dates: string[]
  actual: (number | null)[] // real price sampled onto the grid (null in future)
  actualMa: (number | null)[] // real trailing MA sampled onto the grid (null in future)
  modelMa: number[] // value baseline
  envelope: number[]
  priceOverMa: number[]
  projected: number[]
}

export function projectForecast(
  cfg: ForecastConfig,
  data: { times: number[]; prices: number[]; ma: (number | null)[] },
): ForecastResult {
  const { times, prices, ma } = data
  const n = times.length
  const lastDataTime = times[n - 1]

  // Last observed MA value/date — the anchor for the linear projection.
  let lastMa = 0
  let lastMaDate = lastDataTime
  for (let i = n - 1; i >= 0; i--) {
    if (ma[i] != null) {
      lastMa = ma[i] as number
      lastMaDate = times[i]
      break
    }
  }

  const firstMs = times[0]
  const step = cfg.resolutionDays * DAY_MS

  const dates: string[] = []
  const actual: (number | null)[] = []
  const actualMa: (number | null)[] = []
  const modelMa: number[] = []
  const envelope: number[] = []
  const priceOverMa: number[] = []
  const projected: number[] = []

  for (let t = firstMs; t <= cfg.horizonMs; t += step) {
    const xG = daysSince(t, cfg.dayZeroMs)

    // --- value growth → model_ma ---
    let mval: number
    if (cfg.growthType === 'exponential') {
      mval = cfg.expConstant * Math.exp(cfg.expExponent * xG)
    } else if (cfg.growthType === 'power') {
      mval = cfg.powConstant * Math.pow(Math.max(xG + 1, 1), cfg.powExponent)
    } else {
      if (t <= lastMaDate) {
        const idx = nearestIndex(times, t)
        const m = idx >= 0 ? ma[idx] : null
        mval = m != null ? m : lastMa
      } else {
        mval = lastMa + cfg.linRate * ((t - lastMaDate) / DAY_MS)
      }
    }

    // --- volatility envelope ---
    let env: number
    if (cfg.envelopeType === 'exponential-decay') {
      env = 1 + cfg.envConstant * Math.exp(-cfg.envExponent * xG)
    } else if (cfg.envelopeType === 'value-power-decay') {
      env = 1 + cfg.vpdConstant / Math.pow(Math.max(mval, 1e-9), cfg.vpdPower)
    } else if (cfg.envelopeType === 'value-exponential-decay') {
      env =
        1 +
        cfg.vedConstant * Math.exp(-cfg.vedExponent * Math.pow(Math.max(mval, 1e-9), cfg.vedPower))
    } else {
      env = cfg.constValue
    }

    // --- volatility distribution → price/MA multiplier ---
    let pom: number
    if (cfg.distributionType === 'peaks') {
      let peaksSum = 0
      const xd = (t - firstMs) / DAY_MS
      for (const pd of cfg.peakDatesMs) {
        const peakDay = (pd - firstMs) / DAY_MS
        peaksSum += Math.exp(-cfg.peakSpread * Math.abs(xd - peakDay))
      }
      pom = 1 + (env - 1) * peaksSum
    } else {
      pom = env
    }

    dates.push(toISO(t))
    modelMa.push(mval)
    envelope.push(env)
    priceOverMa.push(pom)
    projected.push(mval * pom)
    if (t <= lastDataTime) {
      const idx = nearestIndex(times, t)
      actual.push(idx >= 0 ? prices[idx] : null)
      actualMa.push(idx >= 0 ? ma[idx] : null)
    } else {
      actual.push(null)
      actualMa.push(null)
    }
  }

  return { dates, actual, actualMa, modelMa, envelope, priceOverMa, projected }
}
