// Shared display formatters used across the chart components.

/** USD with cents under $10, whole dollars above; em-dash for null. */
export function fmtUSD(v: number | null): string {
  if (v == null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 2 : 0 })
}

/** Signed percentage from a fraction (0.5 → "+50.0%"). */
export function fmtPct(v: number | null): string {
  return v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'
}

/** BTC amount to 6 dp. */
export function fmtBtc(v: number | null): string {
  return v == null ? '—' : v.toFixed(6) + ' BTC'
}
