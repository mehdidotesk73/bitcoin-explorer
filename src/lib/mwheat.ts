// Multi-scale M/W heat indicator.
//
// Three horizons (daily/weekly/monthly), each a self-consistent Bollinger lens.
// Per horizon: smooth the PRICE (causal EMA), express it in band-position
// b-space, derive a trend operator τ and a sustained-trend vote, then run a soft
// phase-machine DP that matches the 7-phase M sequence (W = the same matcher on
// −b). Horizon scores are pooled via atanh (agreement reinforces, conflict
// cancels) into a single H[t] ∈ (−1, 1): +1 = strong M (hot), −1 = strong W
// (cool), 0 = neutral.
//
// Causal by construction: H[t] depends only on data at times ≤ t. The only
// filters are trailing/one-sided (causal EMA, trailing windows).
//
// See docs (M/W Heat Score — Design & Implementation Guide) for the full spec.

export type Horizon = 'daily' | 'weekly' | 'monthly'

export const HORIZON_UNIT_DAYS: Record<Horizon, number> = {
  daily: 1,
  weekly: 5,
  monthly: 20,
}

export interface MwHeatParams {
  /** Bollinger period in horizon units (band window = N × hd). */
  N: number
  /** Which lenses to activate. */
  horizons: Horizon[]
  /** Per-horizon weight in the composite (aligned with `horizons`). */
  weights: number[]
  // Global multipliers (one set governs all horizons, scaled by hd).
  alpha: number // P_s EMA span = α × hd
  beta: number // trend regression window = β × hd
  gamma: number // vote window = γ × hd
  lFactor: number // lookback = L_factor × N × hd (reserved; DP is single-pass)
  // Phase-machine fuzzy widths (in b-units / τ-units).
  tauMA: number // "near MA" zone half-width
  tauBand: number // "near band" zone half-width
  tauTurn: number // "τ ≈ 0" turning-point zone half-width
  delta: number // crossing-detection lag (days)
  // Composite.
  gain: number // global gain G on the atanh sum
  epsilon: number // safety clamp before atanh
  sigmaFloorFrac: number // σ floor as a fraction of mean price
}

export const DEFAULT_MW_PARAMS: MwHeatParams = {
  N: 20,
  horizons: ['daily', 'weekly', 'monthly'],
  weights: [0.2, 0.4, 0.4],
  alpha: 1,
  beta: 2,
  gamma: 3,
  lFactor: 3,
  tauMA: 0.5,
  tauBand: 0.5,
  tauTurn: 0.35,
  delta: 1,
  gain: 1,
  epsilon: 0.001,
  sigmaFloorFrac: 0.001,
}

/** Per-horizon intermediate signals, surfaced for the diagnostic view. */
export interface MwHeatHorizonDiag {
  horizon: Horizon
  hd: number
  bandWindow: number
  k: number
  ma: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
  smoothed: number[] // P_s (causal EMA of price)
  b: (number | null)[] // band position of P_s
  tau: number[] // trend operator ∈ [−1, 1]
  vote: number[] // sustained-trend vote ∈ [−1, 1]
  heat: number[] // single-horizon H_s ∈ (−1, 1)
}

export interface MwHeatResult {
  heat: number[] // composite H[t] ∈ (−1, 1)
  horizons: MwHeatHorizonDiag[]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const relu = (x: number) => (x > 0 ? x : 0)
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const atanh = (x: number) => 0.5 * Math.log((1 + x) / (1 - x))

/** Causal (trailing) EMA with the given span. Seeded with the first value. */
function causalEMA(values: number[], span: number): number[] {
  const n = values.length
  const out = new Array(n).fill(0)
  if (n === 0) return out
  const a = 2 / (Math.max(1, span) + 1)
  out[0] = values[0]
  for (let i = 1; i < n; i++) out[i] = a * values[i] + (1 - a) * out[i - 1]
  return out
}

/** Trailing mean & population std over a full `window`; null before warm-up. */
function rollingMeanStd(
  values: number[],
  window: number,
): { ma: (number | null)[]; sigma: (number | null)[] } {
  const n = values.length
  const ma: (number | null)[] = new Array(n).fill(null)
  const sigma: (number | null)[] = new Array(n).fill(null)
  const w = Math.max(1, Math.round(window))
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    sum += values[i]
    sumSq += values[i] * values[i]
    if (i >= w) {
      sum -= values[i - w]
      sumSq -= values[i - w] * values[i - w]
    }
    if (i >= w - 1) {
      const mean = sum / w
      ma[i] = mean
      sigma[i] = Math.sqrt(Math.max(0, sumSq / w - mean * mean))
    }
  }
  return { ma, sigma }
}

/**
 * Trend operator τ[t] = sign(slope)·r² · min(|slope|/slopeScale, 1), from an OLS
 * fit of log(P_s) over the trailing `trendWindow`. slopeScale = 0.05/trendWindow
 * (a 5% move over the window saturates). τ ∈ [−1, 1].
 */
function trendOperator(priceS: number[], trendWindow: number): number[] {
  const n = priceS.length
  const out = new Array(n).fill(0)
  const L = Math.max(2, Math.round(trendWindow))
  const slopeScale = 0.05 / L
  // x = 0..L-1; precompute x stats.
  const sx = (L * (L - 1)) / 2
  const sxx = ((L - 1) * L * (2 * L - 1)) / 6
  const denom = L * sxx - sx * sx
  for (let t = 0; t < n; t++) {
    if (t < L - 1) continue
    let sy = 0
    let sxy = 0
    for (let i = 0; i < L; i++) {
      const y = Math.log(Math.max(priceS[t - L + 1 + i], 1e-12))
      sy += y
      sxy += i * y
    }
    const slope = denom !== 0 ? (L * sxy - sx * sy) / denom : 0
    const meanY = sy / L
    // r² from residuals.
    let ssTot = 0
    let ssRes = 0
    const intercept = (sy - slope * sx) / L
    for (let i = 0; i < L; i++) {
      const y = Math.log(Math.max(priceS[t - L + 1 + i], 1e-12))
      const pred = slope * i + intercept
      ssRes += (y - pred) ** 2
      ssTot += (y - meanY) ** 2
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
    out[t] = Math.sign(slope) * clamp(r2, 0, 1) * clamp(Math.abs(slope) / slopeScale, 0, 1)
  }
  return out
}

/** Sustained-trend vote: share of up-days (τ>0) in the trailing window, → [−1,1]. */
function rollingVote(tau: number[], voteWindow: number): number[] {
  const n = tau.length
  const out = new Array(n).fill(0)
  const w = Math.max(1, Math.round(voteWindow))
  let up = 0
  const isUp = (x: number) => (x > 0 ? 1 : 0)
  for (let i = 0; i < n; i++) {
    up += isUp(tau[i])
    if (i >= w) up -= isUp(tau[i - w])
    const count = Math.min(i + 1, w)
    out[i] = (up / count) * 2 - 1
  }
  return out
}

// Phase-machine emission tables for the M template, expressed purely in terms of
// the input arrays (b, τ, vote). The W detector is this matcher run on the
// negated arrays — f_W(b) ≡ f_M(−b).
const NUM_PHASES = 7
// Partial-credit weight per phase: monotone, peaks at the completing phase P6.
const PHASE_WEIGHT = [0.3, 0.45, 0.55, 0.7, 0.8, 0.9, 1.0]

/**
 * Position membership of day t for phase p of the M template, in b-space.
 * `bp` is b at t−Δ (for crossing tests), `bPrev` is b at t−1 (for P5 slope).
 */
function posMembership(
  p: number,
  b: number,
  bDelta: number,
  bPrev: number,
  P: MwHeatParams,
): number {
  const above = sigmoid(b / P.tauMA)
  const below = 1 - above
  const aboveDelta = sigmoid(bDelta / P.tauMA)
  const belowDelta = 1 - aboveDelta
  const nearUpper = Math.exp(-(((b - 1) / P.tauBand) ** 2))
  switch (p) {
    case 0:
      return below // below MA
    case 1:
      return above * belowDelta * sigmoid((b - bDelta) / 0.1) // cross up
    case 2:
      return nearUpper // near upper band
    case 3:
      return below * aboveDelta * sigmoid((bDelta - b) / 0.1) // cross down
    case 4:
      return below // trough below MA
    case 5:
      return below * sigmoid((b - bPrev) / 0.05) // below MA but rising
    case 6:
      return below // falling again, still below
    default:
      return 0
  }
}

/** Trend membership of day t for phase p of the M template. */
function trendMembership(p: number, tau: number, vote: number, P: MwHeatParams): number {
  const turn = Math.exp(-((tau / P.tauTurn) ** 2))
  switch (p) {
    case 0:
      return relu(vote)
    case 1:
      return relu(vote)
    case 2:
      return turn
    case 3:
      return relu(-vote)
    case 4:
      return turn
    case 5:
      return relu(vote)
    case 6:
      return relu(-vote)
    default:
      return 0
  }
}

/**
 * Soft Viterbi forward pass scoring how well the window ending at each day tells
 * the M story. Returns f_M[t] ∈ [0, 1]. Single forward pass: A[0] restarts each
 * day, advances move exactly one phase, dwelling allowed; the path score is the
 * geometric mean of emissions (length-normalised, log-space).
 */
function phaseMachine(
  b: number[],
  tau: number[],
  vote: number[],
  P: MwHeatParams,
): number[] {
  const n = b.length
  const out = new Array(n).fill(0)
  const NEG = -Infinity
  // logA[p], len[p] for the previous day.
  let prevLog = new Array(NUM_PHASES).fill(NEG)
  let prevLen = new Array(NUM_PHASES).fill(0)
  const d = Math.max(1, Math.round(P.delta))
  for (let t = 0; t < n; t++) {
    const curLog = new Array(NUM_PHASES).fill(NEG)
    const curLen = new Array(NUM_PHASES).fill(0)
    const bDelta = t >= d ? b[t - d] : b[t]
    const bPrev = t >= 1 ? b[t - 1] : b[t]
    for (let p = 0; p < NUM_PHASES; p++) {
      const emis = clamp(
        posMembership(p, b[t], bDelta, bPrev, P) * trendMembership(p, tau[t], vote[t], P),
        P.epsilon,
        1,
      )
      const logE = Math.log(emis)
      if (p === 0) {
        curLog[p] = logE // fresh start every day
        curLen[p] = 1
      } else {
        const dwell = prevLog[p]
        const adv = prevLog[p - 1]
        if (dwell === NEG && adv === NEG) {
          curLog[p] = NEG
          curLen[p] = 0
        } else if (dwell >= adv) {
          curLog[p] = dwell + logE
          curLen[p] = prevLen[p] + 1
        } else {
          curLog[p] = adv + logE
          curLen[p] = prevLen[p - 1] + 1
        }
      }
    }
    // f_M[t] = max_p phaseWeight[p] · geomean(path to p).
    let best = 0
    for (let p = 0; p < NUM_PHASES; p++) {
      if (curLen[p] <= 0 || curLog[p] === NEG) continue
      const geomean = Math.exp(curLog[p] / curLen[p])
      const score = PHASE_WEIGHT[p] * geomean
      if (score > best) best = score
    }
    out[t] = best
    prevLog = curLog
    prevLen = curLen
  }
  return out
}

/** Compute the full multi-scale M/W heat for a daily price series. */
export function mwHeat(price: number[], params: Partial<MwHeatParams> = {}): MwHeatResult {
  const P: MwHeatParams = { ...DEFAULT_MW_PARAMS, ...params }
  const n = price.length
  if (n === 0) return { heat: [], horizons: [] }

  const meanPrice = price.reduce((a, v) => a + v, 0) / n
  const sigmaFloor = P.sigmaFloorFrac * meanPrice
  const k = P.N / 10

  const horizons: MwHeatHorizonDiag[] = []
  for (const horizon of P.horizons) {
    const hd = HORIZON_UNIT_DAYS[horizon]
    const bandWindow = P.N * hd
    const { ma, sigma } = rollingMeanStd(price, bandWindow)
    const upper = ma.map((m, i) => (m == null ? null : m + k * (sigma[i] as number)))
    const lower = ma.map((m, i) => (m == null ? null : m - k * (sigma[i] as number)))

    // Smooth the PRICE, then compute b against the (un-smoothed) bands.
    const smoothed = causalEMA(price, P.alpha * hd)
    const b: (number | null)[] = new Array(n).fill(null)
    const bFilled = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      const m = ma[i]
      if (m == null) continue
      const s = Math.max(sigma[i] as number, sigmaFloor)
      const val = (smoothed[i] - m) / (k * s)
      b[i] = val
      bFilled[i] = val
    }

    const tau = trendOperator(smoothed, P.beta * hd)
    const vote = rollingVote(tau, P.gamma * hd)

    const fM = phaseMachine(bFilled, tau, vote, P)
    const negB = bFilled.map((v) => -v)
    const negTau = tau.map((v) => -v)
    const negVote = vote.map((v) => -v)
    const fW = phaseMachine(negB, negTau, negVote, P)

    const heat = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      // Mute until a full band exists at this horizon.
      heat[i] = ma[i] == null ? 0 : clamp(fM[i] - fW[i], -1, 1)
    }

    horizons.push({ horizon, hd, bandWindow, k, ma, upper, lower, smoothed, b, tau, vote, heat })
  }

  // Composite via atanh evidence pooling: agreeing lenses reinforce.
  const heat = new Array(n).fill(0)
  const wsum = P.weights.reduce((a, v) => a + Math.abs(v), 0) || 1
  for (let t = 0; t < n; t++) {
    let acc = 0
    for (let h = 0; h < horizons.length; h++) {
      const w = P.weights[h] ?? 0
      acc += w * atanh(clamp(horizons[h].heat[t], -1 + P.epsilon, 1 - P.epsilon))
    }
    heat[t] = clamp(Math.tanh((P.gain * acc) / wsum), -1, 1)
  }

  return { heat, horizons }
}
