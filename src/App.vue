<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import PriceExplorer from './components/PriceExplorer.vue'
import ForecastView from './components/ForecastView.vue'
import HodlExplorer from './components/HodlExplorer.vue'
import HelpModal from './components/HelpModal.vue'
import { useBitcoinData } from './lib/useBitcoinData'
import { useVersionCheck } from './lib/useVersionCheck'
import { debugState, logDebug } from './debug'
import { setupPWAUpdates } from './pwa'

const buildId = __BUILD_ID__
const buildTime = __BUILD_TIME__
const showDebug = ref(false)
const copied = ref(false)

// Copy the whole log buffer (plus build stamp) so it can be pasted back here.
async function copyLog() {
  const text = [
    `build ${buildId} · ${buildTime}`,
    ...debugState.logs.map((l) => `${l.time} [${l.kind}] ${l.msg}`),
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    logDebug('clipboard copy failed — select the text manually', 'error')
  }
}

// Keep the installed PWA current: auto-reload on new deploys, plus a manual
// button as a guaranteed way to escape a stale cache.
const { reloadLatest } = setupPWAUpdates()

// Compare the loaded build against the one the live origin is serving, so the
// "Reload latest" button can give honest feedback instead of silently
// reloading into the same version.
const { status: versionStatus, published, checkNow } = useVersionCheck()
const reloadMsg = ref('')

async function onReloadLatest() {
  reloadMsg.value = 'Checking…'
  const status = await checkNow()
  if (status === 'current') {
    // Confirmed up to date — say so rather than faking a reload.
    reloadMsg.value = 'Already on the latest build ✓'
    setTimeout(() => (reloadMsg.value = ''), 2500)
    return
  }
  // A newer build is live (update-ready) — or we couldn't reach version.json
  // (unknown), in which case fall back to the old force-swap-and-reload path.
  reloadMsg.value = 'Updating…'
  await reloadLatest()
}

// Shared price data, fetched/cached once and handed to every tab.
const { raw, loading, error, progress, lastUpdated, refresh, init } = useBitcoinData()
onMounted(init)

type Tab = 'explorer' | 'forecast' | 'hodl'
const tab = ref<Tab>('explorer')

// In-app help: a modal that renders the conceptual docs for each page.
const showHelp = ref(false)
const helpDoc = computed<'overview' | 'explorer' | 'mechanics' | 'hodl'>(() =>
  tab.value === 'forecast' ? 'mechanics' : tab.value === 'hodl' ? 'hodl' : 'explorer',
)
</script>

<template>
  <main class="app">
    <header>
      <div class="title-row">
        <h1 class="app-title">
          <span class="t-bitcoin">bitcoin</span><span class="t-1460">1460</span>
        </h1>
        <button class="help-btn" @click="showHelp = true" aria-label="Help" title="Help">
          ? Help
        </button>
      </div>
      <nav class="tabs">
        <button :class="{ active: tab === 'explorer' }" @click="tab = 'explorer'">
          Price Explorer
        </button>
        <button :class="{ active: tab === 'forecast' }" @click="tab = 'forecast'">
          Price Mechanics
        </button>
        <button :class="{ active: tab === 'hodl' }" @click="tab = 'hodl'">
          Hodl Explorer
        </button>
      </nav>
    </header>

    <PriceExplorer
      v-if="tab === 'explorer'"
      :raw="raw"
      :loading="loading"
      :error="error"
      :progress="progress"
      :last-updated="lastUpdated"
      @refresh="refresh"
    />
    <ForecastView v-else-if="tab === 'forecast'" :raw="raw" :loading="loading" />
    <HodlExplorer
      v-else-if="tab === 'hodl'"
      :raw="raw"
      :loading="loading"
      :error="error"
      :progress="progress"
      @refresh="refresh"
    />

    <footer class="debug">
      <button class="debug-toggle" @click="showDebug = !showDebug">
        build {{ buildId }} · {{ buildTime }}
        <span v-if="debugState.logs.some((l) => l.kind === 'error')" class="err-dot">
          ● {{ debugState.logs.filter((l) => l.kind === 'error').length }} error(s)
        </span>
        <span class="chev">{{ showDebug ? '▲' : '▼' }}</span>
      </button>
      <button
        class="reload-btn"
        :class="{ 'update-ready': versionStatus === 'update-ready' }"
        @click="onReloadLatest"
      >
        {{ versionStatus === 'update-ready' ? 'Update ready — Reload' : 'Reload latest' }}
      </button>
      <span v-if="reloadMsg" class="reload-msg">{{ reloadMsg }}</span>
      <span v-else-if="versionStatus === 'current'" class="reload-msg muted">Up to date</span>
      <span v-else-if="versionStatus === 'update-ready'" class="reload-msg muted">
        latest published: {{ published?.commit }}
      </span>
      <button v-if="showDebug" class="reload-btn" @click="copyLog">
        {{ copied ? 'Copied ✓' : 'Copy log' }}
      </button>
      <ul v-if="showDebug" class="debug-log">
        <li v-if="!debugState.logs.length" class="muted">No log entries yet.</li>
        <li v-for="(l, i) in debugState.logs" :key="i" :class="l.kind">
          <span class="muted">{{ l.time }}</span> {{ l.msg }}
        </li>
      </ul>
    </footer>

    <HelpModal :open="showHelp" :initial-doc="helpDoc" @close="showHelp = false" />
  </main>
</template>

<style scoped>
.app {
  max-width: 60rem;
  margin: 0 auto;
  padding: max(1rem, env(safe-area-inset-top)) 1rem 2rem;
}
/* Centered title banner with the help button pinned right (empty 1fr balances). */
.title-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.app-title {
  grid-column: 2;
  justify-self: center;
  margin: 0;
  font-size: clamp(1.05rem, 4vw, 1.5rem);
  line-height: 1.1;
  white-space: nowrap;
}
.t-bitcoin {
  font-family: 'Ubuntu', system-ui, sans-serif;
  font-weight: 700;
  color: #cbd1dc; /* silver fallback */
}
/* Metallic silver where text-clipping gradients are supported. */
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .t-bitcoin {
    background: linear-gradient(180deg, #f4f6fa 0%, #c3c8d2 46%, #8b93a3 56%, #e6e9ef 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
}
.t-1460 {
  font-family: 'Orbitron', ui-monospace, monospace;
  font-weight: 700;
  color: #f7931a;
  margin-left: 0.3em;
  letter-spacing: 0.02em;
  text-shadow: 0 0 8px rgba(247, 147, 26, 0.4);
}
.help-btn {
  grid-column: 3;
  justify-self: end;
  align-self: start;
  background: var(--bg-elev-2, transparent);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  border-radius: var(--radius, 0.4rem);
  cursor: pointer;
}
.help-btn:hover {
  color: var(--text);
  border-color: var(--accent-blue);
}
.tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.6rem;
}
.tabs button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-weight: 500;
}
.tabs button:hover {
  background: var(--bg-elev-2);
  border-color: var(--border);
  color: var(--text);
}
.tabs button.active {
  background: var(--bg-elev-2);
  border-color: var(--accent-blue);
  color: var(--text);
}
.muted {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.85rem;
}
.debug {
  margin-top: 1.5rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}
.debug-toggle {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.72rem;
  padding: 0.2rem 0;
  cursor: pointer;
}
.debug-toggle:hover {
  background: none;
  color: var(--text);
}
.err-dot {
  color: var(--danger);
  margin-left: 0.4rem;
}
.reload-btn {
  margin-left: 0.6rem;
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
}
/* Draw the eye when a newer build is actually live and waiting. */
.reload-btn.update-ready {
  border-color: var(--accent-blue);
  color: var(--text);
  font-weight: 600;
}
.reload-msg {
  margin-left: 0.5rem;
  font-size: 0.72rem;
  vertical-align: middle;
}
.chev {
  margin-left: 0.3rem;
}
.debug-log {
  list-style: none;
  padding: 0.5rem;
  margin: 0.4rem 0 0;
  background: #060912;
  color: #cdd3e0;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  line-height: 1.5;
  max-height: 12rem;
  overflow: auto;
}
.debug-log .error {
  color: var(--danger);
}
</style>
