// Refresh the app-owned daily-close snapshot (see src/lib/btcSnapshot.ts).
//
//   node --experimental-strip-types scripts/update-btc-data.ts <snapshot.json>
//
// Reads the existing snapshot (if any), fetches only the Binance days after its
// last entry, and rewrites it. With no snapshot yet it seeds from the committed
// CoinMarketCap CSV plus full Binance history (Binance wins overlapping days).
// Run by .github/workflows/data-refresh.yml; exits non-zero if the fetch fails
// so a broken run is visible in the Actions tab.

import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { fetchDailyPrices, EARLIEST_MS } from '../src/api/bitcoin.ts'
import { parseCsv } from '../src/api/supplemental.ts'
import {
  nextSnapshot,
  topUpStart,
  serializeSnapshot,
  parseSnapshot,
} from '../src/lib/btcSnapshot.ts'

const CSV_SEED = 'public/data/btc-pre-binance.csv'
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const path = process.argv[2]
if (!path) {
  console.error('usage: update-btc-data.ts <snapshot.json>')
  process.exit(2)
}

let before = ''
try {
  before = await readFile(path, 'utf8')
} catch {
  /* no snapshot yet */
}
const existing = parseSnapshot(before)

let base = existing
if (!existing.length) {
  base = parseCsv(await readFile(CSV_SEED, 'utf8'))
  console.log(`seeding: ${base.length} CSV days (${day(base[0].time)}..${day(base.at(-1)!.time)})`)
}

const start = topUpStart(existing, EARLIEST_MS)
console.log(`fetching Binance from ${day(start)}`)
const fresh = await fetchDailyPrices(start, (p) => console.log(`  page ${p.pages}: ${p.bars} bars`))

const merged = nextSnapshot(existing, base, fresh, Date.now()) // throws → non-zero exit

const after = serializeSnapshot(merged)
const changed = after !== before
if (changed) await writeFile(path, after)

const last = day(merged.at(-1)!.time)
console.log(
  `${changed ? 'updated' : 'unchanged'}: ${merged.length} days through ${last} ` +
    `(+${merged.length - existing.length})`,
)
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\nlast_day=${last}\n`)
}
