import { parseSnapshot, SNAPSHOT_FILE } from '../lib/btcSnapshot'
import type { PricePoint } from './bitcoin'

// The app-owned daily-close snapshot, bundled into each build from the `data`
// branch (see src/lib/btcSnapshot.ts). Absent in local dev / before the first
// nightly run → [] and the caller falls back to CSV + full live fetch.
const FILE = `data/${SNAPSHOT_FILE}`

export async function loadSnapshot(signal?: AbortSignal): Promise<PricePoint[]> {
  try {
    // no-cache: revalidate with the server so a new deploy's snapshot is seen.
    const res = await fetch(import.meta.env.BASE_URL + FILE, { signal, cache: 'no-cache' })
    if (!res.ok) return []
    return parseSnapshot(await res.text())
  } catch {
    return []
  }
}
