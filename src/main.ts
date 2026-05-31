import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { installErrorHandlers, logDebug } from './debug'

installErrorHandlers()

const app = createApp(App)
// Surface Vue render/watcher errors on screen too (no console on mobile).
app.config.errorHandler = (err, _instance, info) => {
  logDebug(`vue error (${info}): ${err instanceof Error ? err.message : err}`, 'error')
  // Re-throw to keep default logging behaviour in dev tools.
  console.error(err)
}
app.mount('#app')
