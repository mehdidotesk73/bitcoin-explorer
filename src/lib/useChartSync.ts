// Cross-figure sync for the Price Explorer charts — the same lean, all-native
// model the Hodl Explorer uses (and which feels smooth on device):
//
//   • Every chart joins the `btc-explorer` `echarts.connect` group, so ECharts
//     natively mirrors the **crosshair / tooltip** (axisPointer) and the
//     inside-zoom pan/pinch across all figures. No hand-drawn crosshair, no
//     per-pointer `setOption` — that was the source of the jank.
//   • A tiny zoom bridge keeps the **slider range** and the **preset range
//     buttons** in step across the separate chart components (connect alone
//     doesn't carry the slider's start/end to siblings). The `near` guard makes
//     it idempotent, so it co-exists with connect without double-applying.
import { watch, type ShallowRef } from 'vue'
import * as echarts from 'echarts/core'

export const EXPLORER_GROUP = 'btc-explorer'
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

export function useChartSync(opts: {
  chart: ShallowRef<echarts.ECharts | undefined>
  getZoom: () => [number, number]
  onZoom: (z: [number, number]) => void
}) {
  let suppress = false

  function currentZoom(): [number, number] {
    const dz = (opts.chart.value?.getOption() as any)?.dataZoom?.[0]
    return dz ? [dz.start ?? 0, dz.end ?? 100] : [0, 100]
  }

  // Call once, right after the chart is initialised.
  function attach() {
    const c = opts.chart.value
    if (!c) return
    c.group = EXPLORER_GROUP
    echarts.connect(EXPLORER_GROUP)
    c.on('datazoom', () => {
      if (suppress) return
      const [s, e] = currentZoom()
      const [ps, pe] = opts.getZoom()
      if (near(s, ps) && near(e, pe)) return
      opts.onZoom([s, e])
    })
  }

  // Apply externally-driven range changes (sibling chart / preset buttons).
  watch(opts.getZoom, ([s, e]) => {
    const [cs, ce] = currentZoom()
    if (near(cs, s) && near(ce, e)) return
    suppress = true
    opts.chart.value?.dispatchAction({ type: 'dataZoom', start: s, end: e })
    suppress = false
  })

  return { attach }
}
