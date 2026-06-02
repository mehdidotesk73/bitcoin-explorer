// Sustained-run detection at a single, continuously-tunable scale.
//
// For a window `hd` (in days): smooth the price (causal EMA), express it in
// band-position b-space against a trailing Bollinger window, derive a trend
// operator τ and a sustained-trend "vote", then segment the vote into RUNS —
// maximal stretches where sustainment clears a threshold in one direction.
// Choppy (sub-threshold) days break runs and are left unsegmented.
//
// Causal by construction: every signal depends only on data at times ≤ t
// (trailing EMA, trailing windows).

/** A sustained run: [start, end] inclusive day indices, dir +1 up / −1 down. */
export interface Run {
  start: number
  end: number
  dir: 1 | -1
}

/** Tuning for the run/scale pipeline (all windows scale from the scale `hd`). */
export interface RunParams {
  N: number // Bollinger period in horizon units (band window = N × hd)
  alpha: number // P_s EMA span = α × hd
  beta: number // trend regression window = β × hd
  gamma: number // vote window = γ × hd
  sustThresh: number // vote level a run must clear to read as "sustained"
  sigmaFloorFrac: number // σ floor as a fraction of mean price
}

export const DEFAULT_RUN_PARAMS: RunParams = {
  N: 20,
  alpha: 1,
  beta: 2,
  gamma: 3,
  sustThresh: 0.4,
  sigmaFloorFrac: 0.001,
}

/** Run-relevant signals at one scale — drives the metrics panel + run overlay. */
export interface ScaleDiag {
  hd: number
  ma: (number | null)[]
  smoothed: number[] // P_s (causal EMA of price) — the series runs are built on
  b: (number | null)[]
  vote: number[]
  runs: Run[]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

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
 * the threshold in one direction. Sub-threshold (choppy) days break runs and are
 * left unsegmented.
 */
function segmentRuns(vote: number[], thresh: number): Run[] {
  const runs: Run[] = []
  let cur: Run | null = null
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

/** Run-relevant signals at one continuously-tunable scale `hd` (days). */
export function scaleDiag(price: number[], hd: number, params: Partial<RunParams> = {}): ScaleDiag {
  const P: RunParams = { ...DEFAULT_RUN_PARAMS, ...params }
  const n = price.length
  if (n === 0) return { hd, ma: [], smoothed: [], b: [], vote: [], runs: [] }

  const meanPrice = price.reduce((a, v) => a + v, 0) / n
  const sigmaFloor = P.sigmaFloorFrac * meanPrice
  const k = P.N / 10
  const bandWindow = P.N * hd
  const { ma, sigma } = rollingMeanStd(price, bandWindow)

  // Smooth the PRICE, then compute b against the (un-smoothed) bands.
  const smoothed = causalEMA(price, P.alpha * hd)
  const b: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const m = ma[i]
    if (m == null) continue
    const s = Math.max(sigma[i] as number, sigmaFloor)
    b[i] = (smoothed[i] - m) / (k * s)
  }

  const tau = trendOperator(smoothed, P.beta * hd)
  const vote = rollingVote(tau, P.gamma * hd)
  const runs = segmentRuns(vote, P.sustThresh)
  return { hd, ma, smoothed, b, vote, runs }
}
