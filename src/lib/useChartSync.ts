// Cross-figure sync + the pan/crosshair interaction shared by every Explorer/
// Forecast chart. Built to use *the most of ECharts' own features*, so it stays
// smooth:
//
//   • Optional connect group → ECharts natively mirrors the crosshair/tooltip
//     (axisPointer) and inside-zoom across the figures in that group. No
//     hand-drawn crosshair, no per-pointer setOption.
//   • Optional zoom bridge → a tiny, idempotent relay that carries the slider
//     range + preset buttons across separate chart components (connect alone
//     doesn't move the slider on siblings). Omit it for a lone chart.
//   • Pan vs. crosshair is just two native flags flipped per gesture:
//       - pan:       dataZoom.inside.moveOnMouseMove = true , tooltip.triggerOn = 'none'
//       - crosshair: dataZoom.inside.moveOnMouseMove = false, tooltip.triggerOn = 'mousemove'
//     Zoom (pinch + wheel) is independent of both, so it always works.
//
// Touch model: drag = pan; long-press then drag = crosshair (pan frozen); on
// release the crosshair stays (sticky, via a programmatic showTip) until the next
// drag pans it away or a tap dismisses it. Desktop is left fully native — hover
// shows the crosshair, drag pans, wheel zooms.
import { watch, onBeforeUnmount, type Ref, type ShallowRef } from 'vue'
import * as echarts from 'echarts/core'

export const EXPLORER_GROUP = 'btc-explorer'
const near = (a: number, b: number) => Math.abs(a - b) < 0.05
const LONG_PRESS_MS = 320
const MOVE_TOL = 10 // px of finger travel that commits a press to a pan

type Mode = 'pan' | 'crosshair'

export function useChartSync(opts: {
  chart: ShallowRef<echarts.ECharts | undefined>
  el: Ref<HTMLElement | undefined>
  /** Connect group to join — omit for a single, standalone chart. */
  group?: string
  /** Current graphed range; provide with `onZoom` to enable the zoom bridge. */
  getZoom?: () => [number, number]
  onZoom?: (z: [number, number]) => void
  /** Pixel → data index, for the sticky read-out. Defaults to a category axis
   *  (round the converted x); pass a custom mapping for a value/log x-axis. */
  pixelToIndex?: (px: number, py: number) => number | null
}) {
  const syncZoom = !!(opts.getZoom && opts.onZoom)

  // Touch device = no hover + coarse pointer. Desktop keeps the fully-native
  // hover-crosshair / drag-pan behaviour and skips all of the gesture handling.
  const isTouch =
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches

  // --- Zoom bridge ----------------------------------------------------------
  let suppress = false
  function currentZoom(): [number, number] {
    const dz = (opts.chart.value?.getOption() as any)?.dataZoom?.[0]
    return dz ? [dz.start ?? 0, dz.end ?? 100] : [0, 100]
  }
  if (syncZoom) {
    watch(opts.getZoom!, ([s, e]) => {
      const [cs, ce] = currentZoom()
      if (near(cs, s) && near(ce, e)) return
      suppress = true
      opts.chart.value?.dispatchAction({ type: 'dataZoom', start: s, end: e })
      suppress = false
    })
  }

  // --- Pan / crosshair mode (touch only) ------------------------------------
  let mode: Mode = 'pan'
  let modeApplied = false
  function setMode(next: Mode) {
    if (modeApplied && next === mode) return // skip redundant setOption (would flicker the tip)
    mode = next
    modeApplied = true
    opts.chart.value?.setOption({
      tooltip: { triggerOn: next === 'crosshair' ? 'mousemove' : 'none' },
      dataZoom: [{ moveOnMouseMove: next === 'pan' }],
    })
  }
  function localXY(t: Touch): [number, number] {
    const r = opts.el.value!.getBoundingClientRect()
    return [t.clientX - r.left, t.clientY - r.top]
  }
  function defaultIndexFromXY(x: number, y: number): number | null {
    const c = opts.chart.value
    if (!c || !c.containPixel({ gridIndex: 0 }, [x, y])) return null
    const r = c.convertFromPixel({ gridIndex: 0 }, [x, y]) as number[] | null
    if (!r) return null
    const i = Math.round(r[0])
    return i >= 0 ? i : null
  }
  const indexFromXY = (x: number, y: number) =>
    opts.pixelToIndex ? opts.pixelToIndex(x, y) : defaultIndexFromXY(x, y)

  // showTip/hideTip are synced across the connect group, so driving the touched
  // chart lights the crosshair on every figure.
  const showAt = (idx: number) => opts.chart.value?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx })
  const clearTip = () => opts.chart.value?.dispatchAction({ type: 'hideTip' })

  let timer: ReturnType<typeof setTimeout> | null = null
  let crosshair = false // finger currently driving the crosshair
  let panning = false
  let persisted = false // a sticky crosshair is showing from a previous gesture
  let sx = 0, sy = 0, lx = 0, ly = 0
  let lastIdx: number | null = null

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null }
  }
  function enterCrosshair() {
    if (panning) return
    crosshair = true
    setMode('crosshair') // freeze pan; let ECharts follow the finger natively
    const i = indexFromXY(lx, ly)
    if (i != null) { lastIdx = i; showAt(i) }
  }

  function onTouchStart(ev: TouchEvent) {
    if (ev.touches.length > 1) { clearTimer(); return } // two-finger → native pinch
    const [x, y] = localXY(ev.touches[0])
    sx = lx = x; sy = ly = y
    panning = false
    crosshair = false
    setMode('pan') // baseline; a held programmatic tip stays shown through this
    clearTimer()
    timer = setTimeout(enterCrosshair, LONG_PRESS_MS)
  }
  function onTouchMove(ev: TouchEvent) {
    if (ev.touches.length > 1) { clearTimer(); return }
    const [x, y] = localXY(ev.touches[0])
    lx = x; ly = y
    if (crosshair) {
      ev.preventDefault() // hold the page still; ECharts moves the crosshair
      const i = indexFromXY(x, y)
      if (i != null) lastIdx = i
      return
    }
    if (!panning && (Math.abs(x - sx) > MOVE_TOL || Math.abs(y - sy) > MOVE_TOL)) {
      panning = true
      clearTimer()
      if (persisted) { clearTip(); persisted = false } // a new pan clears the sticky crosshair
    }
  }
  function onTouchEnd() {
    clearTimer()
    if (crosshair) {
      // Leave the crosshair where the finger lifted (sticky read-out). Re-enable
      // pan for the next drag; the programmatic showTip persists under triggerOn
      // 'none' until a pan or tap clears it.
      crosshair = false
      setMode('pan')
      if (lastIdx != null) { showAt(lastIdx); persisted = true }
    } else if (!panning && persisted) {
      // A plain tap dismisses the sticky crosshair.
      clearTip()
      persisted = false
    }
    panning = false
  }

  // --- Wire up --------------------------------------------------------------
  function attach() {
    const c = opts.chart.value
    if (!c) return
    if (opts.group) {
      c.group = opts.group
      echarts.connect(opts.group)
    }
    if (syncZoom) {
      c.on('datazoom', () => {
        if (suppress) return
        const [s, e] = currentZoom()
        const [ps, pe] = opts.getZoom!()
        if (near(s, ps) && near(e, pe)) return
        opts.onZoom!([s, e])
      })
    }
    if (isTouch) {
      setMode('pan') // touch starts in pan mode (no crosshair until a long-press)
      const el = opts.el.value
      if (el) {
        el.addEventListener('touchstart', onTouchStart, { passive: true })
        el.addEventListener('touchmove', onTouchMove, { passive: false })
        el.addEventListener('touchend', onTouchEnd, { passive: true })
        el.addEventListener('touchcancel', onTouchEnd, { passive: true })
      }
    }
  }

  onBeforeUnmount(() => {
    clearTimer()
    const el = opts.el.value
    if (el) {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  })

  return { attach }
}
