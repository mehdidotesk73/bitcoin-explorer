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
  let swRegistration: ServiceWorkerRegistration | undefined

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      logDebug(`service worker registered`)
      swRegistration = registration
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

  /** Wait until a freshly-installing worker finishes (or a short timeout). */
  function waitForWorker(sw: ServiceWorker): Promise<void> {
    return new Promise((resolve) => {
      const done = () => resolve()
      const timer = setTimeout(done, 5000) // don't hang the button
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated' || sw.state === 'redundant') {
          clearTimeout(timer)
          done()
        }
      })
    })
  }

  /**
   * Manual "Reload latest". The plain `updateServiceWorker(true)` only acts on an
   * *already-waiting* worker, so when the network `version.json` reports a newer
   * build before the service worker has fetched it, it would reload the same
   * cached bundle. So force an update check first, wait for the new worker to
   * install, then activate it and reload.
   */
  async function reloadLatest() {
    logDebug('manual update requested')
    try {
      const reg = swRegistration ?? (await navigator.serviceWorker?.getRegistration())
      if (reg) {
        await reg.update() // pull the new sw.js now, if any
        const pending = reg.installing ?? reg.waiting
        if (pending) {
          logDebug('newer build found — installing')
          await waitForWorker(pending)
        }
      }
    } catch (err) {
      logDebug(`update check failed: ${err}`, 'error')
    }
    await updateServiceWorker(true) // skip-waiting on the new worker, if any
    location.reload()
  }

  return { reloadLatest }
}
