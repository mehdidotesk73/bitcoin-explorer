// Shared chart gesture + crosshair bridge for the Price Explorer figures.
//
// One interaction model, identical across every figure (price chart + the
// stacked separate-curve panel):
//   • 1-finger drag            → pan the graphed range (ECharts inside zoom)
//   • long-press, then drag    → crosshair mode: panning freezes, the crosshair
//                                follows the finger and the hovered day index is
//                                lifted to shared state so all figures line up
//   • 2-finger pinch           → zoom
//   • desktop: hover           → crosshair, drag → pan, wheel → zoom
//
// The crosshair persists after release (so the value stays readable) and clears
// the moment a new pan begins. Zoom is kept in sync through the parent's
// `v-model:zoom` (single source of truth) — we deliberately do NOT use
// `echarts.connect`, which double-applied the zoom and fought the drag.
import { watch, onBeforeUnmount, type Ref, type ShallowRef } from 'vue'
import type * as echarts from 'echarts/core'

export interface ChartGestureOptions {
  chart: ShallowRef<echarts.ECharts | undefined>
  el: Ref<HTMLElement | undefined>
  /** Current graphed range [start, end] in percent (from props). */
  getZoom: () => [number, number]
  /** Shared crosshair day index (from props); null = none. */
  getHoverIndex: () => number | null | undefined
  /** Number of category points on the x-axis. */
  getCount: () => number
  /** Number of stacked grids (1 for a single-grid chart). */
  getGridCount: () => number
  /** Vertical span [y1, y2] in px for the crosshair line. */
  getCrosshairY: () => [number, number]
  /** Emit a new zoom window upward. */
  onZoom: (z: [number, number]) => void
  /** Emit the active crosshair index upward (null = cleared). */
  onHover: (idx: number | null) => void
}

const CROSS_COLOR = '#8b94ac'
const LONG_PRESS_MS = 300
const MOVE_TOL = 10 // px of finger travel that turns a press into a pan
const near = (a: number, b: number) => Math.abs(a - b) < 0.05

export function useChartGestures(o: ChartGestureOptions) {
  // --- Crosshair ------------------------------------------------------------
  function indexFromPixel(px: number, py: number): number | null {
    const c = o.chart.value
    if (!c) return null
    const n = o.getCount()
    // Only react inside an actual plot grid — this keeps moves over the bottom
    // zoom slider from drawing a crosshair (which made the slider feel laggy).
    for (let g = 0; g < o.getGridCount(); g++) {
      if (!c.containPixel({ gridIndex: g }, [px, py])) continue
      const r = c.convertFromPixel({ gridIndex: g }, [px, py]) as number[] | null
      if (r) {
        const idx = Math.round(r[0])
        if (idx >= 0 && idx < n) return idx
      }
    }
    return null
  }

  function drawCrosshair(idx: number | null) {
    const c = o.chart.value
    if (!c) return
    if (idx == null) {
      c.setOption({ graphic: [{ id: 'xhair', $action: 'remove' }] })
      c.dispatchAction({ type: 'hideTip' })
      return
    }
    const px = c.convertToPixel({ xAxisIndex: 0 }, idx) as number | null
    if (px == null) return
    const [y1, y2] = o.getCrosshairY()
    c.setOption({
      graphic: [
        {
          id: 'xhair',
          type: 'line',
          z: 50,
          silent: true,
          shape: { x1: px, y1, x2: px, y2 },
          style: { stroke: CROSS_COLOR, lineWidth: 1, lineDash: [4, 4] },
        },
      ],
    })
    // Surface the value at the crosshair so multiple figures can be read at the
    // same time location.
    c.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx })
  }

  // Mirror the shared (parent-held) crosshair index onto this figure.
  watch(o.getHoverIndex, (idx) => drawCrosshair(idx ?? null))

  function setPanEnabled(enable: boolean) {
    o.chart.value?.setOption({ dataZoom: [{ moveOnMouseMove: enable }] })
  }

  // --- Zoom sync (parent v-model is the single source of truth) -------------
  let suppressZoom = false
  function currentZoom(): [number, number] {
    const opt = o.chart.value?.getOption() as any
    const dz = opt?.dataZoom?.[0]
    return dz ? [dz.start ?? 0, dz.end ?? 100] : [0, 100]
  }
  function bindZoomSync() {
    o.chart.value?.on('datazoom', () => {
      if (suppressZoom) return
      const [s, e] = currentZoom()
      const [ps, pe] = o.getZoom()
      if (near(s, ps) && near(e, pe)) return
      o.onZoom([s, e])
    })
  }
  watch(o.getZoom, ([s, e]) => {
    const [cs, ce] = currentZoom()
    if (near(cs, s) && near(ce, e)) return
    suppressZoom = true
    o.chart.value?.dispatchAction({ type: 'dataZoom', start: s, end: e })
    suppressZoom = false
    // Keep a persisted crosshair aligned after a programmatic range change.
    const hi = o.getHoverIndex()
    if (hi != null) drawCrosshair(hi)
  })

  // --- Gesture state machine ------------------------------------------------
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let crosshairMode = false // touch: panning frozen, finger drives the crosshair
  let panning = false
  let mouseDown = false
  let touching = false
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0

  function clearTimer() {
    if (pressTimer != null) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }
  function localXY(clientX: number, clientY: number): [number, number] {
    const r = o.el.value!.getBoundingClientRect()
    return [clientX - r.left, clientY - r.top]
  }
  function enterCrosshair() {
    if (panning) return
    crosshairMode = true
    setPanEnabled(false) // freeze the bounds while the finger reads values
    const idx = indexFromPixel(lastX, lastY)
    o.onHover(idx) // null ok — the watch will draw once we move onto the grid
  }

  function onTouchStart(ev: TouchEvent) {
    touching = true
    if (ev.touches.length > 1) {
      clearTimer()
      crosshairMode = false
      return // two fingers → let ECharts pinch-zoom
    }
    const [x, y] = localXY(ev.touches[0].clientX, ev.touches[0].clientY)
    startX = lastX = x
    startY = lastY = y
    panning = false
    clearTimer()
    pressTimer = setTimeout(enterCrosshair, LONG_PRESS_MS)
  }
  function onTouchMove(ev: TouchEvent) {
    if (ev.touches.length > 1) {
      clearTimer()
      crosshairMode = false
      return // pinch → ECharts
    }
    const [x, y] = localXY(ev.touches[0].clientX, ev.touches[0].clientY)
    lastX = x
    lastY = y
    if (crosshairMode) {
      ev.preventDefault() // hold the page still; move the crosshair instead
      o.onHover(indexFromPixel(x, y))
      return
    }
    if (!panning && (Math.abs(x - startX) > MOVE_TOL || Math.abs(y - startY) > MOVE_TOL)) {
      // Finger travelled before the long-press fired → this is a pan.
      clearTimer()
      panning = true
      o.onHover(null) // a new pan clears the persisted crosshair
    }
    // While panning we stay out of the way and let ECharts move the window.
  }
  function onTouchEnd() {
    clearTimer()
    touching = false
    if (crosshairMode) {
      crosshairMode = false
      setPanEnabled(true) // re-arm panning; the crosshair stays drawn (persists)
    }
    panning = false
  }

  // Desktop mouse: hover → crosshair, drag → pan (ECharts), wheel → zoom.
  // `zrByTouch` marks events zrender synthesised from touch — ignore those, the
  // touch handlers below own them.
  function onZrMouseMove(ev: any) {
    if (ev?.zrByTouch || touching || mouseDown) return // synth-touch / active drag-pan
    o.onHover(indexFromPixel(ev.offsetX, ev.offsetY))
  }
  function onZrMouseDown(ev: any) {
    if (ev?.zrByTouch || touching) return
    mouseDown = true
    o.onHover(null) // starting a drag-pan clears the crosshair
  }
  function onZrMouseUp(ev: any) {
    if (ev?.zrByTouch) return
    mouseDown = false
  }

  function attach() {
    const c = o.chart.value
    if (!c) return
    bindZoomSync()
    const zr = c.getZr()
    zr.on('mousemove', onZrMouseMove)
    zr.on('mousedown', onZrMouseDown)
    zr.on('mouseup', onZrMouseUp)
    const el = o.el.value
    if (el) {
      el.addEventListener('touchstart', onTouchStart, { passive: true })
      el.addEventListener('touchmove', onTouchMove, { passive: false })
      el.addEventListener('touchend', onTouchEnd, { passive: true })
      el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    }
  }

  onBeforeUnmount(() => {
    clearTimer()
    const el = o.el.value
    if (el) {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  })

  return { attach, drawCrosshair }
}
