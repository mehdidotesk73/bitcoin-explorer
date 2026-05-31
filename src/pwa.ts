import { watch } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { logDebug } from './debug'

// How often an open app re-checks the server for a newer deploy. iOS keeps
// installed PWAs alive for a long time, so without this an open app could miss
// a deploy and keep serving the cached build.
const UPDATE_CHECK_MS = 60_000

/**
 * Registers the service worker, polls for new deploys, and auto-reloads into
 * them. Returns `updateServiceWorker` so the UI can offer a manual button.
 */
export function setupPWAUpdates() {
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      logDebug(`service worker registered`)
      if (registration) {
        setInterval(() => {
          registration.update().catch(() => {})
        }, UPDATE_CHECK_MS)
      }
    },
    onRegisterError(err) {
      logDebug(`service worker register error: ${err}`, 'error')
    },
  })

  // As soon as a new build is detected, swap to it and reload.
  watch(needRefresh, (ready) => {
    if (ready) {
      logDebug('new build detected — reloading')
      updateServiceWorker(true)
    }
  })

  /** Force a check now, then activate + reload if anything is waiting. */
  async function reloadLatest() {
    logDebug('manual update requested')
    await updateServiceWorker(true)
    // If the SW was already current, updateServiceWorker won't reload; do it.
    location.reload()
  }

  return { reloadLatest }
}
