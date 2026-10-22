import { describe, it, expect } from 'vitest'
import {
  mergeDaily,
  completeDays,
  serializeSnapshot,
  parseSnapshot,
  topUpStart,
  nextSnapshot,
  DAY_MS,
} from './btcSnapshot'

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const pt = (iso: string, price: number) => ({ time: d(iso), price })

describe('mergeDaily', () => {
  it('keeps one point per UTC day, later lists winning, sorted', () => {
    const csv = [pt('2018-01-02', 1), pt('2018-01-01', 1)]
    const binance = [pt('2018-01-02', 2), pt('2018-01-03', 2)]
    expect(mergeDaily(csv, binance)).toEqual([
      pt('2018-01-01', 1),
      pt('2018-01-02', 2),
      pt('2018-01-03', 2),
    ])
  })

  it('normalises intraday times to midnight UTC', () => {
    const noon = d('2020-05-05') + 12 * 3_600_000
    expect(mergeDaily([{ time: noon, price: 7 }])).toEqual([pt('2020-05-05', 7)])
  })
})

describe('completeDays', () => {
  it("drops today's still-moving close (and anything later)", () => {
    const now = d('2026-10-22') + 5 * 3_600_000
    const pts = [pt('2026-10-21', 1), pt('2026-10-22', 2), pt('2026-10-23', 3)]
    expect(completeDays(pts, now)).toEqual([pt('2026-10-21', 1)])
  })
})

describe('serializeSnapshot / parseSnapshot', () => {
  it('round-trips, one day per line', () => {
    const pts = [pt('2010-07-13', 0.05816341), pt('2026-10-21', 82270.1)]
    const text = serializeSnapshot(pts)
    expect(text).toBe('[\n{"t":"2010-07-13","c":0.05816341},\n{"t":"2026-10-21","c":82270.1}\n]\n')
    expect(parseSnapshot(text)).toEqual(pts)
  })

  it('returns [] for malformed input (e.g. an SPA index.html fallback)', () => {
    expect(parseSnapshot('<!doctype html><html></html>')).toEqual([])
    expect(parseSnapshot('{"t":"2020-01-01"}')).toEqual([])
  })

  it('skips bad rows but keeps good ones', () => {
    const text = '[{"t":"2020-01-01","c":5},{"t":"nope","c":1},{"t":"2020-01-02","c":-1}]'
    expect(parseSnapshot(text)).toEqual([pt('2020-01-01', 5)])
  })
})

describe('topUpStart', () => {
  it('starts the day after the snapshot ends', () => {
    expect(topUpStart([pt('2026-10-20', 1), pt('2026-10-21', 1)], 0)).toBe(d('2026-10-22'))
  })

  it('starts at the earliest date when there is no snapshot', () => {
    expect(topUpStart([], d('2017-08-17'))).toBe(d('2017-08-17'))
  })
})

describe('nextSnapshot', () => {
  const now = d('2026-10-22') + DAY_MS / 2

  it('appends fresh complete days and leaves today out', () => {
    const existing = [pt('2026-10-19', 1), pt('2026-10-20', 1)]
    const fresh = [pt('2026-10-21', 2), pt('2026-10-22', 3)]
    expect(nextSnapshot(existing, existing, fresh, now)).toEqual([...existing, pt('2026-10-21', 2)])
  })

  it('is unchanged when nothing new has closed', () => {
    const existing = [pt('2026-10-21', 1)]
    expect(nextSnapshot(existing, existing, [pt('2026-10-22', 9)], now)).toEqual(existing)
  })

  it('refuses to shrink stored history', () => {
    const existing = [pt('2026-10-20', 1), pt('2026-10-21', 1)]
    expect(() => nextSnapshot(existing, [pt('2026-10-21', 1)], [], now)).toThrow(/shrink/)
  })
})
