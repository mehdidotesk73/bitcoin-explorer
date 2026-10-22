// Cycle-peak schedule: peaks are defined by their spacing, not by absolute
// dates. A schedule is an anchor date for the first past peak, the gaps (days)
// between successive past peaks, and the gaps between projected peaks — the
// first projected gap is measured from the last past peak. Dates are derived,
// so editing one gap shifts every later peak with it.

import { DAY_MS } from './forecast'

export interface PeakSchedule {
  /** First past peak (ms), or null when there are no past peaks. */
  firstMs: number | null
  /** Days between successive past peaks (length = past count − 1). */
  pastGaps: number[]
  /** Days between projected peaks; [0] is measured from the last past peak. */
  projGaps: number[]
}

/**
 * Split absolute peak dates into a schedule: peaks on/before `splitMs` are
 * past, the rest projected. Gaps are rounded to whole days.
 */
export function scheduleFromDates(datesMs: number[], splitMs: number): PeakSchedule {
  const sorted = [...datesMs].sort((a, b) => a - b)
  const past = sorted.filter((d) => d <= splitMs)
  const proj = sorted.filter((d) => d > splitMs)
  const gaps = (xs: number[], from: number | null) =>
    xs.map((d, i) => {
      const prev = i === 0 ? from : xs[i - 1]
      return prev == null ? 0 : Math.round((d - prev) / DAY_MS)
    })
  const firstMs = past.length ? past[0] : null
  const lastPast = past.length ? past[past.length - 1] : null
  return {
    firstMs,
    pastGaps: gaps(past, null).slice(1),
    // With no past peaks, projected gaps count from `splitMs` (the data edge).
    projGaps: gaps(proj, lastPast ?? splitMs),
  }
}

/**
 * Derive the peak dates. `anchorMs` stands in for the last past peak when
 * there are none (projected peaks then count from it).
 */
export function scheduleDates(
  s: PeakSchedule,
  anchorMs: number,
): { past: number[]; projected: number[] } {
  const past: number[] = []
  if (s.firstMs != null) {
    let t = s.firstMs
    past.push(t)
    for (const g of s.pastGaps) past.push((t += g * DAY_MS))
  }
  const projected: number[] = []
  let t = past.length ? past[past.length - 1] : anchorMs
  for (const g of s.projGaps) projected.push((t += g * DAY_MS))
  return { past, projected }
}

/** `count` equal gaps of `spacing` days. */
export const uniformGaps = (count: number, spacing: number): number[] =>
  Array.from({ length: count }, () => spacing)

/**
 * Remove the peak that gap `i` leads to, keeping every later peak on its date:
 * gap i folds into gap i+1. Removing the last peak just drops its gap.
 */
export function removeGap(gaps: number[], i: number): number[] {
  const out = [...gaps]
  if (i < out.length - 1) out[i + 1] += out[i]
  out.splice(i, 1)
  return out
}

/** Mean gap rounded to whole days, or `fallback` when there are none. */
export const meanGap = (gaps: number[], fallback: number): number =>
  gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : fallback
