// Generic closed-form (weighted) least-squares curve fitter.
//
// Phase A of the stochastic-projection plan (docs/TODO.md → "Stochastic price
// mechanics"). A model is "linear in features after a space transform": we fit
// coefficients β minimising  Σ wᵢ · (T(yᵢ) − φ(xᵢ)·β)² , where T is the identity
// ('linear') or ln ('log'). Power-law and exponential models become plain
// weighted OLS this way, so the fit is closed-form — no optimiser — matching the
// instant-OLS property forecast.ts relies on.
//
// The fitter is deliberately agnostic to where the points come from: callers
// (Phase B providers) supply (xs, ys); the value-growth curve and the volatility
// envelope are both just models passed to this one function. Uncertainty
// (resampling → ensembles) lands in Phase C on top of this core.

export type FitSpace = 'linear' | 'log'

export interface CurveModel<P> {
  /** Design row for x. Include a constant `1` term for an intercept. */
  features: (x: number) => number[]
  /** Map fitted LS coefficients → named model parameters. */
  rebuild: (coeffs: number[]) => P
}

export interface FitMetrics {
  /** R² in the fit space (matches `linregress` on the transformed y). */
  r2: number
  /** Residuals in the fit space, T(y) − prediction. What Phase C resamples. */
  residuals: number[]
  n: number
}

export interface FitResult<P> {
  params: P
  /** Raw LS coefficients, aligned with `model.features`' output order. */
  coeffs: number[]
  /** Fitted quantity in natural units: invT(φ(x)·β). */
  eval: (x: number) => number
  metrics: FitMetrics
}

export interface FitOptions {
  space?: FitSpace
  weights?: number[]
}

const dot = (a: number[], b: number[]): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Fit-space transform pair: identity for 'linear', ln/exp for 'log'. */
function transforms(space: FitSpace): { T: (v: number) => number; invT: (v: number) => number } {
  return space === 'log'
    ? { T: Math.log, invT: Math.exp }
    : { T: (v) => v, invT: (v) => v }
}

/**
 * Solve A·x = b for a small k×k system via Gaussian elimination with partial
 * pivoting. `A` is row-major (k rows of k), `b` has length k. A singular system
 * yields zeros for the unresolved coefficients (callers guard n ≥ k).
 */
function solveLinear(A: number[][], b: number[]): number[] {
  const k = b.length
  const M = A.map((row, i) => [...row, b[i]]) // augmented [A | b]
  for (let col = 0; col < k; col++) {
    let piv = col
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (piv !== col) {
      const tmp = M[piv]
      M[piv] = M[col]
      M[col] = tmp
    }
    const d = M[col][col]
    if (d === 0) continue
    for (let r = 0; r < k; r++) {
      if (r === col) continue
      const f = M[r][col] / d
      if (f === 0) continue
      for (let c = col; c <= k; c++) M[r][c] -= f * M[col][c]
    }
  }
  const x = new Array(k).fill(0)
  for (let i = 0; i < k; i++) {
    const d = M[i][i]
    x[i] = d === 0 ? 0 : M[i][k] / d
  }
  return x
}

/**
 * Fit `model` to (xs, ys) by weighted least squares in the chosen space.
 * Returns the named params, the raw coefficients, an `eval` closure (fitted
 * quantity in natural units), and fit-space metrics (R² + residuals).
 */
export function fitCurve<P>(
  xs: number[],
  ys: number[],
  model: CurveModel<P>,
  opts: FitOptions = {},
): FitResult<P> {
  const space = opts.space ?? 'linear'
  const n = xs.length
  const { T, invT } = transforms(space)

  const Phi: number[][] = new Array(n)
  const ty: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    Phi[i] = model.features(xs[i])
    ty[i] = T(ys[i])
  }
  const k = n > 0 ? Phi[0].length : 0

  // Weighted normal equations: (ΦᵀWΦ)·β = ΦᵀW·ty
  const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0))
  const rhs: number[] = new Array(k).fill(0)
  let sumW = 0
  let sumWy = 0
  for (let i = 0; i < n; i++) {
    const w = opts.weights ? opts.weights[i] : 1
    const phi = Phi[i]
    sumW += w
    sumWy += w * ty[i]
    for (let a = 0; a < k; a++) {
      rhs[a] += w * phi[a] * ty[i]
      for (let b = 0; b < k; b++) A[a][b] += w * phi[a] * phi[b]
    }
  }

  const coeffs = n >= k && k > 0 ? solveLinear(A, rhs) : new Array(k).fill(0)

  // R² + residuals, both in the fit space (so they match a `linregress` on T(y)).
  const meanY = sumW > 0 ? sumWy / sumW : 0
  let ssRes = 0
  let ssTot = 0
  const residuals: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const w = opts.weights ? opts.weights[i] : 1
    const e = ty[i] - dot(Phi[i], coeffs)
    residuals[i] = e
    ssRes += w * e * e
    ssTot += w * (ty[i] - meanY) ** 2
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  return {
    params: model.rebuild(coeffs),
    coeffs,
    eval: (x: number) => invT(dot(model.features(x), coeffs)),
    metrics: { r2, residuals, n },
  }
}

// ---------------------------------------------------------------------------
// Phase C — resampling → ensemble of alternative tunes.
//
// Each strategy perturbs the inputs and re-fits, yielding an ensemble of
// plausible coefficient sets. The strategy must match the data density (see the
// stochastic-projection plan in docs/TODO.md):
//   • residual-block — for the many autocorrelated value-curve points: shuffle
//     blocks of fit-space residuals (preserving short-range autocorrelation) and
//     re-apply them to the fitted curve (model·exp(r*) in log space), then refit.
//   • jackknife / cases — for the few hand-picked cycle-top points: a residual
//     bootstrap on 3–4 near-perfectly-fit points gives a fake-tight band; the
//     real uncertainty is "only 3–4 cycles", so resample *whole points* (each
//     point is one cycle, so this is the composite provider+fit varying which
//     tops form the edge). jackknife = leave-one-out; cases = draw n w/ replace.
// The fit stays closed-form, so B≈1000 refits remain near-instant.
// ---------------------------------------------------------------------------

export type Resample =
  | { kind: 'residual-block'; blockLen: number; B: number; seed?: number }
  | { kind: 'jackknife' }
  | { kind: 'cases'; B: number; seed?: number }

export interface Ensemble<P> {
  /** The fit on the unperturbed data — the central tune. */
  base: FitResult<P>
  /** One refit per resample draw (jackknife: one per dropped point). */
  members: FitResult<P>[]
  /**
   * Predictive spread from the ensemble: for each quantile q (0–100), the
   * member-`eval` values across `xs`. Returns one number[] per quantile, aligned
   * with `quantiles`. (Parameter/trend uncertainty — see the Phase D labelling.)
   */
  bandAt: (xs: number[], quantiles: number[]) => number[][]
}

/** Deterministic, seedable PRNG (mulberry32) so ensembles reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Linear-interpolated p-th percentile (0–100) of an ascending array. */
function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (n - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

/** Circular moving-block bootstrap of a residual vector (preserves runs). */
function blockResample(res: number[], blockLen: number, rng: () => number): number[] {
  const n = res.length
  const L = Math.max(1, Math.min(Math.floor(blockLen), n))
  const out: number[] = []
  while (out.length < n) {
    const start = Math.floor(rng() * n)
    for (let k = 0; k < L && out.length < n; k++) out[out.length] = res[(start + k) % n]
  }
  return out
}

/**
 * Build an ensemble of refits via the chosen `resample` strategy. `bandAt` reads
 * predictive quantiles off the members. Closed-form refits keep this cheap.
 */
export function fitEnsemble<P>(
  xs: number[],
  ys: number[],
  model: CurveModel<P>,
  resample: Resample,
  opts: FitOptions = {},
): Ensemble<P> {
  const base = fitCurve(xs, ys, model, opts)
  const n = xs.length
  const k = n > 0 ? model.features(xs[0]).length : 0
  const { T, invT } = transforms(opts.space ?? 'linear')
  const members: FitResult<P>[] = []

  if (resample.kind === 'residual-block') {
    const rng = mulberry32(resample.seed ?? 0x9e3779b9)
    // Fitted fit-space values, so synthetic targets are fitted + shuffled resid.
    const fittedT = xs.map((x) => T(base.eval(x)))
    for (let b = 0; b < resample.B; b++) {
      const star = blockResample(base.metrics.residuals, resample.blockLen, rng)
      const ysStar = fittedT.map((f, i) => invT(f + star[i]))
      members.push(fitCurve(xs, ysStar, model, opts))
    }
  } else if (resample.kind === 'jackknife') {
    // Leave-one-cycle-out: drop each point in turn (needs > k points to fit).
    if (n > k) {
      for (let drop = 0; drop < n; drop++) {
        const xj: number[] = []
        const yj: number[] = []
        const wj: number[] | undefined = opts.weights ? [] : undefined
        for (let i = 0; i < n; i++) {
          if (i === drop) continue
          xj.push(xs[i])
          yj.push(ys[i])
          if (wj && opts.weights) wj.push(opts.weights[i])
        }
        members.push(fitCurve(xj, yj, model, { ...opts, weights: wj }))
      }
    }
  } else {
    // cases: draw n points with replacement; skip degenerate (< k distinct x).
    const rng = mulberry32(resample.seed ?? 0x85ebca6b)
    for (let b = 0; b < resample.B; b++) {
      const xc: number[] = []
      const yc: number[] = []
      const wc: number[] | undefined = opts.weights ? [] : undefined
      const seen = new Set<number>()
      for (let i = 0; i < n; i++) {
        const j = Math.floor(rng() * n)
        seen.add(xs[j])
        xc.push(xs[j])
        yc.push(ys[j])
        if (wc && opts.weights) wc.push(opts.weights[j])
      }
      if (seen.size < k) continue
      members.push(fitCurve(xc, yc, model, { ...opts, weights: wc }))
    }
  }

  const bandAt = (gx: number[], quantiles: number[]): number[][] => {
    const pool = members.length > 0 ? members : [base]
    return quantiles.map((q) =>
      gx.map((x) => {
        const vals = pool
          .map((m) => m.eval(x))
          .filter((v) => Number.isFinite(v))
          .sort((a, b) => a - b)
        return quantileSorted(vals, q)
      }),
    )
  }

  return { base, members, bandAt }
}
