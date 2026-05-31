import type { PricePoint } from './bitcoin'

// Optional supplemental price history committed as a static asset. Drop a
// CoinMarketCap CSV export (or any CSV with a date and close column) at
// `public/data/btc-pre-binance.csv` and it will be loaded and merged with the
// live Binance data. If the file is absent or unparseable, we return [] and the
// app silently falls back to Binance-only data.
const FILE = 'data/btc-pre-binance.csv'

// Header names we recognise, in priority order. CoinMarketCap exports use
// `timeClose`/`timeOpen`/`timestamp`; generic exports use `date`.
const DATE_COLUMNS = ['timeclose', 'timestamp', 'timeopen', 'date']
const CLOSE_COLUMNS = ['close', 'price']

export async function loadSupplemental(signal?: AbortSignal): Promise<PricePoint[]> {
  try {
    const url = import.meta.env.BASE_URL + FILE
    const res = await fetch(url, { signal })
    if (!res.ok) return [] // no file deployed → Binance only
    return parseCsv(await res.text())
  } catch {
    return []
  }
}

export function parseCsv(text: string): PricePoint[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return []

  // Auto-detect delimiter: CMC often uses ';', generic exports use ','.
  const semis = (lines[0].match(/;/g) ?? []).length
  const commas = (lines[0].match(/,/g) ?? []).length
  const delim = semis > commas ? ';' : ','

  const header = splitLine(lines[0], delim).map((h) => h.trim().toLowerCase())
  const dateIdx = pickColumn(header, DATE_COLUMNS)
  const closeIdx = pickColumn(header, CLOSE_COLUMNS)
  if (dateIdx < 0 || closeIdx < 0) return []

  const out: PricePoint[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delim)
    const time = Date.parse((cols[dateIdx] ?? '').trim())
    const price = Number((cols[closeIdx] ?? '').trim())
    if (Number.isFinite(time) && Number.isFinite(price)) {
      out.push({ time, price })
    }
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

function pickColumn(header: string[], candidates: string[]): number {
  for (const name of candidates) {
    const i = header.indexOf(name)
    if (i >= 0) return i
  }
  return -1
}

// Minimal CSV field splitter that respects double-quoted fields.
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      quoted = !quoted
    } else if (c === delim && !quoted) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}
