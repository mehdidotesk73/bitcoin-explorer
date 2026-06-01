// Bitcoin "price mechanics" forecast engine.
//
// Implements the model distilled in docs/forecast-model.md:
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
// Linear growth: take the Nth-percentile of the trailing MA slopes observed over
// the last `slopeWindowDays` of history (0 = all history). 50 ≈ the median.
export const DEFAULT_SLOPE_WINDOW_DAYS = 365
export const DEFAULT_SLOPE_PERCENTILE = 50
// Inner regression window for each rolling slope sample. Short relative to the
// 4yr MA so the per-sample slopes vary enough for the percentile to matter.
export const SLOPE_INNER_WINDOW_DAYS = 90

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
function rollingSlopes(
  times: number[],
  ma: (number | null)[],
  windowDays: number,
): number[] {
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
  slopeWindowDays = DEFAULT_SLOPE_WINDOW_DAYS,
  slopePercentile = DEFAULT_SLOPE_PERCENTILE,
): FittedParams {
  const lastTime = times[times.length - 1] ?? 0
  const fitCutoff = fitWindowDays > 0 ? lastTime - fitWindowDays * DAY_MS : -Infinity

  const xExp: number[] = []
  const yExp: number[] = []
  const xPow: number[] = []
  const yPow: number[] = []
  // Daily samples are uniform in x but the power fit regresses on ln(x+1), so
  // recent years are exponentially over-represented. Weighting each point by
  // (x+1)^(−γ) counteracts that: γ=0 is plain per-sample OLS, γ=1 gives equal
  // weight per log-time decade (lets early cycles steepen the slope).
  const wPow: number[] = []
  for (let i = 0; i < times.length; i++) {
    const m = ma[i]
    if (m == null || m <= 0) continue
    if (times[i] < fitCutoff) continue // outside the calibration window
    const x = daysSince(times[i], dayZeroMs)
    if (x <= 0) continue
    xExp.push(x)
    yExp.push(Math.log(m)) // ln(MA) = ln C + α·x
    xPow.push(Math.log(x + 1))
    yPow.push(Math.log(m)) // ln(MA) = ln C + β·ln(x+1)
    wPow.push(powFitGamma !== 0 ? Math.pow(x + 1, -powFitGamma) : 1)
  }
  const expFit = linregress(xExp, yExp)
  const powFit = linregress(xPow, yPow, powFitGamma !== 0 ? wPow : undefined)

  // Envelope: at a cycle top, price/MA ≈ envelope, so price/MA − 1 ≈ C·e^(−λx).
  const xEnv: number[] = []
  const yEnv: number[] = []
  for (const pd of peakDatesMs) {
    if (pd > lastTime) continue // future top: not observable yet
    const i = nearestIndex(times, pd)
    if (i < 0) continue
    if (Math.abs(times[i] - pd) > 45 * DAY_MS) continue
    const m = ma[i]
    if (m == null || m <= 0) continue
    const ratio = prices[i] / m - 1
    if (ratio > 0) {
      xEnv.push(daysSince(times[i], dayZeroMs))
      yEnv.push(Math.log(ratio))
    }
  }
  const envFit =
    xEnv.length >= 2
      ? linregress(xEnv, yEnv)
      : { slope: -0.000511, intercept: Math.log(48.77), r2: 0 }

  // Linear rate: the chosen percentile of the trailing MA slopes observed
  // across the last `slopeWindowDays` of history (0 = all history). The inner
  // regression window is kept short (SLOPE_INNER_WINDOW_DAYS) so the slope
  // distribution has real spread — a year-long inner window over the already
  // very smooth 4yr MA collapses every percentile onto the same value.
  const slopeCutoff =
    slopeWindowDays > 0 ? lastTime - slopeWindowDays * DAY_MS : -Infinity
  const slopes = rollingSlopes(times, ma, SLOPE_INNER_WINDOW_DAYS)
    .filter((s, i) => Number.isFinite(s) && times[i] >= slopeCutoff)
    .sort((a, b) => a - b)
  const linRate = percentile(slopes, slopePercentile)

  return {
    expConstant: Math.exp(expFit.intercept),
    expExponent: expFit.slope,
    expR2: expFit.r2,
    powConstant: Math.exp(powFit.intercept),
    powExponent: powFit.slope,
    powR2: powFit.r2,
    envConstant: Math.exp(envFit.intercept),
    envExponent: -envFit.slope,
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
        cfg.vedConstant *
          Math.exp(-cfg.vedExponent * Math.pow(Math.max(mval, 1e-9), cfg.vedPower))
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
