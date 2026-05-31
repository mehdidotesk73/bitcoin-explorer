// Fetches historical daily BTC/USD closing prices from Binance's public
// market-data endpoint. This endpoint is keyless, CORS-enabled, and not
// geo-blocked. Its klines API returns at most 1000 bars per request, so we
// paginate by advancing the start time until we reach the present.

const BASE = 'https://data-api.binance.vision/api/v3/klines'
const SYMBOL = 'BTCUSDT'
const INTERVAL = '1d'
const PAGE_LIMIT = 1000

// BTCUSDT started trading on Binance in mid-August 2017.
export const EARLIEST_MS = Date.parse('2017-08-17T00:00:00Z')

export interface PricePoint {
  /** Bar open time, epoch milliseconds (UTC). */
  time: number
  /** Closing price in USD. */
  price: number
}

export interface FetchProgress {
  /** Number of bars accumulated so far. */
  bars: number
  /** Pages (requests) completed so far. */
  pages: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Paginated fetch of all daily closes from `startTime` to now.
 * Calls `onProgress` after each page so the UI can show progress.
 */
export async function fetchDailyPrices(
  startTime: number = EARLIEST_MS,
  onProgress?: (p: FetchProgress) => void,
  signal?: AbortSignal,
): Promise<PricePoint[]> {
  const out: PricePoint[] = []
  const now = Date.now()
  let cursor = startTime
  let pages = 0

  while (cursor < now) {
    const url = `${BASE}?symbol=${SYMBOL}&interval=${INTERVAL}&startTime=${cursor}&limit=${PAGE_LIMIT}`
    const res = await fetch(url, { signal })
    if (!res.ok) {
      throw new Error(`Price API returned HTTP ${res.status}. Try again shortly.`)
    }
    const batch: unknown[][] = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break

    for (const k of batch) {
      // kline shape: [openTime, open, high, low, close, volume, ...]
      out.push({ time: Number(k[0]), price: Number(k[4]) })
    }
    pages += 1
    onProgress?.({ bars: out.length, pages })

    if (batch.length < PAGE_LIMIT) break
    // Advance to just after the last bar's open time.
    cursor = Number(batch[batch.length - 1][0]) + 1
    await sleep(120) // be polite to the public endpoint
  }

  return out
}
