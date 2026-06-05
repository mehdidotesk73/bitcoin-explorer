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
  const T = space === 'log' ? Math.log : (v: number) => v
  const invT = space === 'log' ? Math.exp : (v: number) => v

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
