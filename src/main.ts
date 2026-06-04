import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { installErrorHandlers, logDebug } from './debug'

installErrorHandlers()

// The "Reload latest" flow appends a `?fresh=<ts>` cache-buster to force a
// network navigation past the SW/HTTP caches. Tidy it out of the URL once we've
// loaded so it doesn't linger or accumulate.
try {
  const url = new URL(window.location.href)
  if (url.searchParams.has('fresh')) {
    url.searchParams.delete('fresh')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }
} catch {
  // Non-fatal — a stray query param is harmless.
}

const app = createApp(App)
// Surface Vue render/watcher errors on screen too (no console on mobile).
app.config.errorHandler = (err, _instance, info) => {
  logDebug(`vue error (${info}): ${err instanceof Error ? err.message : err}`, 'error')
  // Re-throw to keep default logging behaviour in dev tools.
  console.error(err)
}
app.mount('#app')
