import { parseSnapshot, SNAPSHOT_FILE } from '../lib/btcSnapshot'
import type { PricePoint } from './bitcoin'

// The app-owned daily-close snapshot (see src/lib/btcSnapshot.ts), tried from
// two places:
//  1. live — straight from the `data` branch on GitHub (public, CORS `*`,
//     ~5 min CDN cache), so every deployment (GitHub Pages, Netlify production,
//     PR previews) gets last night's data without a rebuild;
//  2. bundled — the copy baked into this build, if GitHub is unreachable.
// Neither → [] and the caller falls back to CSV + full live fetch.
const LIVE_URL = `https://raw.githubusercontent.com/mehdidotesk73/bitcoin-explorer/data/${SNAPSHOT_FILE}`
const BUNDLED = `data/${SNAPSHOT_FILE}`

export type SnapshotSource = 'live' | 'bundled' | 'none'

async function tryLoad(url: string, signal?: AbortSignal): Promise<PricePoint[]> {
  try {
    // no-cache: revalidate so a fresh nightly / deploy is seen.
    const res = await fetch(url, { signal, cache: 'no-cache' })
    if (!res.ok) return []
    return parseSnapshot(await res.text())
  } catch {
    return []
  }
}

export async function loadSnapshot(
  signal?: AbortSignal,
): Promise<{ points: PricePoint[]; source: SnapshotSource }> {
  const live = await tryLoad(LIVE_URL, signal)
  if (live.length) return { points: live, source: 'live' }
  const bundled = await tryLoad(import.meta.env.BASE_URL + BUNDLED, signal)
  if (bundled.length) return { points: bundled, source: 'bundled' }
  return { points: [], source: 'none' }
}
