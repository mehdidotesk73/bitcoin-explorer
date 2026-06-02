// Multi-scale M/W heat indicator.
//
// Three horizons (daily/weekly/monthly), each a self-consistent Bollinger lens.
// Per horizon: smooth the PRICE (causal EMA), express it in band-position
// b-space, derive a trend operator τ and a sustained-trend vote, then run a soft
// phase-machine DP that segments the b-trace into RUNS and matches the W (and,
// on −b, the M) run-template. Horizon scores are pooled via atanh (agreement
// reinforces, conflict cancels) into a single H[t] ∈ (−1, 1): +1 = strong M
// (hot), −1 = strong W (cool), 0 = neutral.
//
// Run model (the core logic). A "run" is a sustained move: sustainment is the
// share of upticks (or downticks) over a trailing window — ≳70% one direction
// reads as a sustained run. The phase machine's phases ARE runs, gated on
// sustainment × band position, so the Viterbi DP degenerates to run-matching.
// The W is a double bottom: two down-runs whose troughs land below the MA, the
// second pulling back from above, completed by the breakout up-run (see
// scripts/wpattern-example):
//   P0 DR1  down, entirely below MA   → trough 1 (lower band)
//   P1 UR1  up   (forced connector)   → peak 1
//   P2 DR2a down, above MA            ┐ DR2 crosses upper→lower
//   P3 DR2b down, below MA            ┘ → trough 2 (lower band)
//   P4 UR2  up   (the BREAKOUT)       → confirms the W (completing phase)
// M is the same template on −b. Sustainment is measured per-horizon over γ·hd,
// so patterns at a scale are built only from runs sustained at that scale.
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
  tauMA: number // "above/below MA" sigmoid half-width (b-units)
  tauBand: number // "near band" zone half-width (reserved)
  tauTurn: number // "τ ≈ 0" turning-point zone half-width (reserved)
  delta: number // crossing-detection lag (days, reserved)
  // Run sustainment gate, in vote-units (vote = 2·uptick_fraction − 1 ∈ [−1,1]).
  sustThresh: number // vote level a run must clear to read as "sustained" (0.4 ≈ 70% upticks)
  sustWidth: number // sigmoid softness of that threshold
  // Composite.
  gain: number // global gain G on the atanh sum
  horizonGain: number // saturating gain applied to each horizon's f_M − f_W
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
  sustThresh: 0.4,
  sustWidth: 0.2,
  gain: 1.3,
  horizonGain: 4,
  epsilon: 0.001,
  sigmaFloorFrac: 0.001,
}

/** A sustained run: [start, end] inclusive day indices, dir +1 up / −1 down. */
export interface MwHeatRun {
  start: number
  end: number
  dir: 1 | -1
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
  runs: MwHeatRun[] // sustainment-gated runs the matcher reads
  fW: number[] // W-template match score ∈ [0, 1]
  fM: number[] // M-template match score ∈ [0, 1]
}

export interface MwHeatResult {
  heat: number[] // composite H[t] ∈ (−1, 1)
  horizons: MwHeatHorizonDiag[]
}

/** Run-relevant signals for a single (arbitrary) scale — drives the metrics panel
 *  and the price-chart run overlay at a continuously-tunable window. */
export interface ScaleDiag {
  hd: number
  ma: (number | null)[]
  smoothed: number[] // P_s (causal EMA of price) — the series runs are built on
  b: (number | null)[]
  vote: number[]
  runs: MwHeatRun[]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
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

/**
 * Segment the vote signal into runs: maximal stretches where sustainment clears
 * the threshold in one direction. This is exactly the gate the phase emissions
 * use (sustThresh), so the runs shown match what the matcher reads. Sub-threshold
 * (choppy) days break runs and are left unsegmented.
 */
function segmentRuns(vote: number[], thresh: number): MwHeatRun[] {
  const runs: MwHeatRun[] = []
  let cur: MwHeatRun | null = null
  for (let i = 0; i < vote.length; i++) {
    const dir = vote[i] > thresh ? 1 : vote[i] < -thresh ? -1 : 0
    if (dir === 0) {
      if (cur) runs.push(cur)
      cur = null
      continue
    }
    if (cur && cur.dir === dir) cur.end = i
    else {
      if (cur) runs.push(cur)
      cur = { start: i, end: i, dir }
    }
  }
  if (cur) runs.push(cur)
  return runs
}

// Run-template emission tables for the W, expressed purely in terms of the input
// arrays (b, vote). The M detector is this matcher run on the negated arrays —
// f_M(b) ≡ f_W(−b). Each phase IS a run: a sustainment gate (share of up/down
// ticks over the vote window) times a band-position gate.
// Phases: DR1, UR1, DR2a, DR2b, UR2(breakout). The W is complete at UR2 — the
// breakout that confirms the second trough — so the template ends there.
const NUM_PHASES = 5
// Per-phase run direction: +1 = up-run (wants sustained up), −1 = down-run.
const RUN_DIR = [-1, +1, -1, -1, +1] as const
// Per-phase band requirement: −1 = below MA, +1 = above MA, 0 = none.
// Disabled (all 0): an absolute below/above-MA gate INVERTS detection for W/M
// that sit off-centre — e.g. a continuation W inside an uptrend has its troughs
// above the MA, where the gate starves the W template and feeds the mirror M.
// W vs M is therefore decided by run structure + breakout direction (see the
// dirGate in phaseMachine), not by where in the band the pattern happens to sit.
// Kept as a hook in case band position is reintroduced later as a soft bonus.
const RUN_BAND = [0, 0, 0, 0, 0] as const
// Partial-credit weight per phase: monotone, peaks at the completing breakout P4.
// Front weights are low so a single leg (e.g. one down-run) can't, on its own,
// strongly excite the template (or its mirror) — the W only scores high once most
// of its legs are present.
const PHASE_WEIGHT = [0.12, 0.28, 0.5, 0.72, 1.0]

/** Band-position membership of day t for phase p (above/below the MA). */
function posMembership(p: number, b: number, P: MwHeatParams): number {
  const band = RUN_BAND[p]
  if (band === 0) return 1 // connector up-run: no band constraint
  const above = sigmoid(b / P.tauMA)
  return band > 0 ? above : 1 - above
}

/**
 * Sustainment membership of day t for phase p: how strongly the trailing window
 * reads as a sustained run in the phase's direction. vote = 2·uptick_fraction−1,
 * so a down-run wants −vote past the threshold, an up-run wants +vote past it.
 */
function trendMembership(p: number, vote: number, P: MwHeatParams): number {
  const dir = RUN_DIR[p]
  return sigmoid((dir * vote - P.sustThresh) / Math.max(1e-6, P.sustWidth))
}

/**
 * Soft Viterbi forward pass scoring how well the window ending at each day tells
 * the W run-story. Returns f_W[t] ∈ [0, 1]. Single forward pass: A[0] restarts
 * each day, advances move exactly one phase, dwelling allowed (a run lasts many
 * days); the path score is the geometric mean of emissions (length-normalised,
 * log-space) times the phase weight and a breakout-direction gate.
 *
 * Interior runs must be *sustained* (that is what makes them runs) — that is
 * enforced inside the geometric mean via the per-day sustainment emission. The
 * run in progress at the live edge, though, hasn't had time to prove sustainment
 * — "whatever it is, it is" — so we do NOT require it to be sustained; a single
 * bar already counts (its lone weak emission is diluted across the long path).
 *
 * What we DO require at the live edge is direction: the current run must not
 * contradict the phase it terminates in. That is the `dirGate`, applied OUTSIDE
 * the geometric mean (so it bites instead of being diluted). It is lenient — a
 * run only just turning the right way already passes — but a strongly opposite
 * move suppresses the score. This is what lets a W confirm the moment price
 * turns up off trough 2, while stopping the mirror (M) template from
 * "completing" on that same up-move (its breakout needs the opposite direction).
 */
export function phaseMachine(b: number[], vote: number[], P: MwHeatParams): number[] {
  const n = b.length
  const out = new Array(n).fill(0)
  const NEG = -Infinity
  const wd = Math.max(1e-6, P.sustWidth)
  // logA[p], len[p] for the previous day.
  let prevLog = new Array(NUM_PHASES).fill(NEG)
  let prevLen = new Array(NUM_PHASES).fill(0)
  for (let t = 0; t < n; t++) {
    const curLog = new Array(NUM_PHASES).fill(NEG)
    const curLen = new Array(NUM_PHASES).fill(0)
    for (let p = 0; p < NUM_PHASES; p++) {
      const emis = clamp(
        posMembership(p, b[t], P) * trendMembership(p, vote[t], P),
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
    // f_W[t] = max_p phaseWeight[p] · geomean(path to p) · dirGate(p).
    let best = 0
    for (let p = 0; p < NUM_PHASES; p++) {
      if (curLen[p] <= 0 || curLog[p] === NEG) continue
      const geomean = Math.exp(curLog[p] / curLen[p])
      // Lenient (+sustThresh) so a run just turning the phase's way already
      // passes; only a strongly opposite live move suppresses the score.
      const dirGate = sigmoid((RUN_DIR[p] * vote[t] + P.sustThresh) / wd)
      const score = PHASE_WEIGHT[p] * geomean * dirGate
      if (score > best) best = score
    }
    out[t] = best
    prevLog = curLog
    prevLen = curLen
  }
  return out
}

/** Compute the full multi-scale M/W heat for a daily price series. */
/**
 * Shared per-scale band/run computation: the b-trace, trend vote, and sustained
 * runs for a window `hd` (in days). Used by both the multi-horizon `mwHeat` and
 * the continuous-scale `scaleDiag`, so runs are identical wherever they appear.
 */
function bandRuns(price: number[], hd: number, P: MwHeatParams, sigmaFloor: number) {
  const n = price.length
  const k = P.N / 10
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
  const runs = segmentRuns(vote, P.sustThresh)
  return { k, bandWindow, ma, upper, lower, smoothed, b, bFilled, tau, vote, runs }
}

/** Run-relevant signals at one continuously-tunable scale `hd` (days). */
export function scaleDiag(price: number[], hd: number, params: Partial<MwHeatParams> = {}): ScaleDiag {
  const P: MwHeatParams = { ...DEFAULT_MW_PARAMS, ...params }
  const n = price.length
  if (n === 0) return { hd, ma: [], smoothed: [], b: [], vote: [], runs: [] }
  const meanPrice = price.reduce((a, v) => a + v, 0) / n
  const sigmaFloor = P.sigmaFloorFrac * meanPrice
  const { ma, smoothed, b, vote, runs } = bandRuns(price, hd, P, sigmaFloor)
  return { hd, ma, smoothed, b, vote, runs }
}

export function mwHeat(price: number[], params: Partial<MwHeatParams> = {}): MwHeatResult {
  const P: MwHeatParams = { ...DEFAULT_MW_PARAMS, ...params }
  const n = price.length
  if (n === 0) return { heat: [], horizons: [] }

  const meanPrice = price.reduce((a, v) => a + v, 0) / n
  const sigmaFloor = P.sigmaFloorFrac * meanPrice

  const horizons: MwHeatHorizonDiag[] = []
  for (const horizon of P.horizons) {
    const hd = HORIZON_UNIT_DAYS[horizon]
    const { k, bandWindow, ma, upper, lower, smoothed, b, bFilled, tau, vote, runs } = bandRuns(
      price,
      hd,
      P,
      sigmaFloor,
    )

    // The machine matches the W run-template; M is the same template on −b.
    const fW = phaseMachine(bFilled, vote, P)
    const negB = bFilled.map((v) => -v)
    const negVote = vote.map((v) => -v)
    const fM = phaseMachine(negB, negVote, P)

    const heat = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      // Mute until a full band exists at this horizon.
      // f_M and f_W are both small geomeans, so their difference is tiny.
      // A saturating gain spreads a real (if noisy) pattern toward ±1.
      heat[i] = ma[i] == null ? 0 : clamp(Math.tanh(P.horizonGain * (fM[i] - fW[i])), -1, 1)
    }

    horizons.push({ horizon, hd, bandWindow, k, ma, upper, lower, smoothed, b, tau, vote, heat, runs, fW, fM })
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
