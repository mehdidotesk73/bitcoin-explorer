// The app-owned daily-close snapshot (`btc-daily.json`). A nightly GitHub
// Action keeps it on the `data` branch; builds copy it into public/data/ and
// the app tops it up with only the days since it ends.
//
// Format: a JSON array with one day per line, so each nightly commit is a few
// added lines:
//   [
//   {"t":"2010-07-13","c":0.05816341},
//   ...
//   ]
// Only complete UTC days are stored — today's still-moving close never is.
//
// Pure and import-free (type imports only) so the Node update script can load
// it directly.

import type { PricePoint } from '../api/bitcoin'

export const SNAPSHOT_FILE = 'btc-daily.json'
export const DAY_MS = 86_400_000

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** Midnight UTC of the day containing `ms`. */
export const utcDayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS

/**
 * One point per UTC day, sorted. Later lists win on overlapping days (pass
 * the more authoritative source last). Each point is normalised to midnight.
 */
export function mergeDaily(...lists: PricePoint[][]): PricePoint[] {
  const byDay = new Map<string, PricePoint>()
  for (const list of lists)
    for (const p of list) byDay.set(dayKey(p.time), { time: utcDayStart(p.time), price: p.price })
  return [...byDay.values()].sort((a, b) => a.time - b.time)
}

/** Drop the day containing `nowMs` (and anything later): its close isn't final. */
export const completeDays = (points: PricePoint[], nowMs: number): PricePoint[] =>
  points.filter((p) => p.time < utcDayStart(nowMs))

/** First day to fetch: the day after the snapshot ends, or `earliestMs` with none. */
export const topUpStart = (snapshot: PricePoint[], earliestMs: number): number =>
  snapshot.length ? snapshot[snapshot.length - 1].time + DAY_MS : earliestMs

/**
 * The next stored snapshot: `base` (the existing snapshot, or the seed history
 * when there is none) with `fresh` days on top, complete days only. Throws if
 * it would hold fewer days than `existing` — a bad fetch must never erase
 * stored history.
 */
export function nextSnapshot(
  existing: PricePoint[],
  base: PricePoint[],
  fresh: PricePoint[],
  nowMs: number,
): PricePoint[] {
  const next = completeDays(mergeDaily(base, fresh), nowMs)
  if (next.length < existing.length)
    throw new Error(`refusing to shrink snapshot: ${existing.length} -> ${next.length} days`)
  return next
}

export function serializeSnapshot(points: PricePoint[]): string {
  const rows = points.map((p) => JSON.stringify({ t: dayKey(p.time), c: p.price }))
  return `[\n${rows.join(',\n')}\n]\n`
}

/** Parse a snapshot; returns [] for anything malformed. */
export function parseSnapshot(text: string): PricePoint[] {
  try {
    const rows = JSON.parse(text) as { t: string; c: number }[]
    if (!Array.isArray(rows)) return []
    const out: PricePoint[] = []
    for (const r of rows) {
      const time = Date.parse(`${r?.t}T00:00:00Z`)
      if (Number.isFinite(time) && Number.isFinite(r.c) && r.c > 0) out.push({ time, price: r.c })
    }
    return mergeDaily(out)
  } catch {
    return []
  }
}
