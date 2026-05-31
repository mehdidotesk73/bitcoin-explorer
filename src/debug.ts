import { reactive } from 'vue'

// A tiny on-screen log so errors are visible on a phone (where there's no dev
// console). Global handlers below funnel uncaught errors here, and the debug
// panel in App.vue renders them.

export interface LogEntry {
  time: string
  kind: 'error' | 'info'
  msg: string
}

export const debugState = reactive({
  logs: [] as LogEntry[],
})

export function logDebug(msg: string, kind: 'error' | 'info' = 'info') {
  debugState.logs.push({
    time: new Date().toLocaleTimeString(),
    kind,
    msg: String(msg),
  })
  // Keep the buffer small.
  if (debugState.logs.length > 40) debugState.logs.shift()
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Install global handlers so nothing fails silently on mobile. */
export function installErrorHandlers() {
  window.addEventListener('error', (e) => {
    logDebug(`window error: ${e.message || describe(e.error)}`, 'error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    logDebug(`unhandled promise: ${describe(e.reason)}`, 'error')
  })
}
