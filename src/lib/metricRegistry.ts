/**
 * Metric registry: spec-driven metric definitions and state management.
 * Each metric describes its kind (overlay | curve), parameters, and shared-param groups.
 * Enables data-driven UI rendering, persistence (localStorage), and shareability (URL).
 */

// --- Metric registry spec ---

export type MetricKind = 'overlay' | 'curve'
export type ParamType = 'number' | 'select'
export type PeriodUnit = 'day' | 'week' | 'month'

export interface ParamSpec {
  id: string
  label: string
  type: ParamType
  default: number | string
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: string | number }>
  /** If true, treat as a period with a unit dropdown (day/week/month). */
  hasPeriodUnit?: boolean
}

export interface MetricSpec {
  id: string
  label: string
  kind: MetricKind
  params: ParamSpec[]
  /** If set, this metric shares params with another metric (e.g., Bollinger score shares run scale/sensitivity). */
  sharedParamGroup?: string
  /** Tooltip or explanation of the metric. */
  description?: string
}

/** Registry of all available metrics in the Price Explorer. */
export const METRIC_SPECS: Record<string, MetricSpec> = {
  ma: {
    id: 'ma',
    label: 'Moving average',
    kind: 'overlay',
    params: [
      {
        id: 'period',
        label: 'Period',
        type: 'number',
        default: 20,
        min: 1,
        max: 400,
        hasPeriodUnit: true,
      },
    ],
  },
  bb: {
    id: 'bb',
    label: 'Bollinger bands',
    kind: 'overlay',
    params: [
      {
        id: 'period',
        label: 'Period',
        type: 'number',
        default: 20,
        min: 1,
        max: 400,
        hasPeriodUnit: true,
      },
      {
        id: 'k',
        label: 'σ ×',
        type: 'number',
        default: 2,
        min: 0.5,
        max: 5,
        step: 0.5,
      },
    ],
  },
  runs: {
    id: 'runs',
    label: 'Run detection',
    kind: 'overlay',
    params: [
      {
        id: 'scaleT',
        label: 'Scale',
        type: 'number',
        default: 34, // tForHd(31)
        min: 0,
        max: 100,
        step: 1,
      },
      {
        id: 'sensitivity',
        label: 'Sensitivity',
        type: 'number',
        default: 0.2,
        min: 0,
        max: 0.9,
        step: 0.05,
      },
    ],
  },
  ratio: {
    id: 'ratio',
    label: 'Price ÷ MA',
    kind: 'curve',
    params: [
      {
        id: 'maDays',
        label: 'MA window',
        type: 'number',
        default: 1460,
        min: 30,
        max: 2000,
        step: 10,
      },
    ],
  },
  bscore: {
    id: 'bscore',
    label: 'Bollinger score',
    kind: 'curve',
    params: [],
    sharedParamGroup: 'runs',
  },
  runSlope: {
    id: 'runSlope',
    label: 'Run slope',
    kind: 'curve',
    params: [],
    sharedParamGroup: 'runs',
  },
}

// --- Metric state persistence ---

export interface MetricState {
  enabled: Record<string, boolean>
  params: Record<string, Record<string, number | string>>
  periodUnits: Record<string, PeriodUnit>
}

/** Default metric state: overlays off, curves off. */
export function defaultMetricState(): MetricState {
  const enabled: Record<string, boolean> = {}
  const params: Record<string, Record<string, number | string>> = {}
  const periodUnits: Record<string, PeriodUnit> = {}

  for (const spec of Object.values(METRIC_SPECS)) {
    enabled[spec.id] = false
    params[spec.id] = {}
    for (const p of spec.params) {
      params[spec.id][p.id] = p.default
      if (p.hasPeriodUnit) {
        periodUnits[`${spec.id}.${p.id}`] = 'day'
      }
    }
  }

  return { enabled, params, periodUnits }
}

/** Load metric state from localStorage, or return defaults if not found. */
export function loadMetricState(): MetricState {
  const key = 'btc-explorer:metrics'
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Fall through to defaults.
  }
  return defaultMetricState()
}

/** Save metric state to localStorage. */
export function saveMetricState(state: MetricState): void {
  const key = 'btc-explorer:metrics'
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Silently fail if localStorage is unavailable.
  }
}

/** Encode metric state into a URL query string. */
export function encodeMetricState(state: MetricState): string {
  const parts: string[] = []
  for (const [id, enabled] of Object.entries(state.enabled)) {
    if (enabled) {
      parts.push(`m=${id}`)
    }
  }
  for (const [id, values] of Object.entries(state.params)) {
    for (const [key, val] of Object.entries(values)) {
      parts.push(`${id}.${key}=${encodeURIComponent(val)}`)
    }
  }
  for (const [key, unit] of Object.entries(state.periodUnits)) {
    if (unit !== 'day') {
      parts.push(`${key}=${unit}`)
    }
  }
  return parts.join('&')
}

/** Decode metric state from URL query parameters. */
export function decodeMetricState(query: string): Partial<MetricState> {
  const state: Partial<MetricState> = { enabled: {}, params: {}, periodUnits: {} }
  const params = new URLSearchParams(query)

  for (const [key, val] of params.entries()) {
    if (key === 'm') {
      // Enabled metric.
      state.enabled![val] = true
    } else if (key.includes('.')) {
      // Metric param or period unit.
      const [metricId, paramId] = key.split('.')
      if (state.params![metricId] === undefined) {
        state.params![metricId] = {}
      }
      // Try to parse as number; if it fails, treat as string (e.g., period unit).
      const num = Number(val)
      state.params![metricId][paramId] = isNaN(num) ? val : num
    }
  }

  return state
}
