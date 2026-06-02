// Scratch example: does the "three down-runs" rule actually trace a W with two
// troughs?  Build b(t) directly from the spec and eyeball it. Run:
//   npx tsx scripts/wpattern-example.mjs
//
// Spec (in b-space; MA at 0, bands at ±1):
//   DR1  down-run, ENTIRELY below MA (b<0)      -> ends at trough 1 (lower band)
//   UR1  up-run    (forced)                     -> peak 1 (above MA)
//   DR2  down-run, CROSSES upper -> lower       -> ends at trough 2 (lower band)
//   UR2  up-run    (forced)                     -> peak 2 (above MA)
//   DR3  down-run, ENTIRELY above MA (b>0)      -> shallow higher-low
//   UR3  up-run    (breakout)

function ramp(from, to, days) {
  const out = []
  for (let i = 1; i <= days; i++) out.push(from + ((to - from) * i) / days)
  return out
}

// Each leg is a monotone run (100% sustained in its direction).
const b = [
  -0.2, // start just below MA
  ...ramp(-0.2, -1.0, 12), // DR1: descend into lower band  (trough 1)
  ...ramp(-1.0, 0.8, 14), //  UR1: rally above MA           (peak 1)
  ...ramp(0.8, -0.9, 16), //  DR2: cross upper -> lower     (trough 2)
  ...ramp(-0.9, 0.7, 14), //  UR2: rally above MA           (peak 2)
  ...ramp(0.7, 0.2, 8), //    DR3: shallow dip, stays above MA
  ...ramp(0.2, 1.1, 10), //   UR3: breakout
]

// Classify each leg's band occupancy.
const below = (x) => x < 0
const seg = (lo, hi) => b.slice(lo, hi)
function span(name, arr) {
  const allBelow = arr.every(below)
  const allAbove = arr.every((x) => !below(x))
  const crosses = arr.some(below) && arr.some((x) => !below(x))
  const where = allBelow ? 'ENTIRELY below MA' : allAbove ? 'ENTIRELY above MA' : crosses ? 'CROSSES MA' : '—'
  console.log(`  ${name.padEnd(4)} [${arr[0].toFixed(2)} -> ${arr[arr.length - 1].toFixed(2)}]  ${where}`)
}

// Leg boundaries (indices into b, excluding the seed at 0).
console.log('Leg band occupancy:')
span('DR1', seg(1, 13))
span('DR2', seg(27, 43))
span('DR3', seg(57, 65))

// Find interior local minima (troughs).
const troughs = []
for (let i = 1; i < b.length - 1; i++) if (b[i] <= b[i - 1] && b[i] < b[i + 1]) troughs.push(i)
console.log(`\nTroughs at indices ${JSON.stringify(troughs)} -> b = ${troughs.map((i) => b[i].toFixed(2)).join(', ')}`)
console.log(`Both troughs below MA? ${troughs.every((i) => below(b[i]))}`)

// ASCII plot, MA line marked with ':'.
console.log('\nb(t)  (top = +1.2, MA = 0 row marked |, bottom = -1.2):')
const H = 17
for (let row = 0; row < H; row++) {
  const level = 1.2 - (2.4 * row) / (H - 1)
  let line = ''
  for (const v of b) {
    const cell = Math.abs(v - level) <= 1.2 / (H - 1) ? '#' : Math.abs(level) < 0.075 ? '.' : ' '
    line += cell
  }
  console.log(`${level.toFixed(1).padStart(5)} ${line}`)
}
