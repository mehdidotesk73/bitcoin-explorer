<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { renderMarkdown } from '../lib/markdown'
import overviewMd from '../../docs/concepts/overview.md?raw'
import explorerMd from '../../docs/concepts/price-explorer.md?raw'
import mechanicsMd from '../../docs/concepts/price-mechanics.md?raw'
import hodlMd from '../../docs/concepts/hodl-explorer.md?raw'

const props = defineProps<{
  open: boolean
  /** Which doc to open on first show: matches the active app tab. */
  initialDoc: DocId
}>()
const emit = defineEmits<{ close: [] }>()

type DocId = 'overview' | 'explorer' | 'mechanics' | 'hodl'
const DOCS: { id: DocId; label: string; md: string }[] = [
  { id: 'overview', label: 'Overview', md: overviewMd },
  { id: 'explorer', label: 'Price Explorer', md: explorerMd },
  { id: 'mechanics', label: 'Price Mechanics', md: mechanicsMd },
  { id: 'hodl', label: 'Hodl Explorer', md: hodlMd },
]

const active = ref<DocId>(props.initialDoc)
// Jump to the active app tab's doc each time the modal is opened.
watch(
  () => props.open,
  (o) => {
    if (o) active.value = props.initialDoc
  },
)

const html = computed(() => {
  const doc = DOCS.find((d) => d.id === active.value) ?? DOCS[0]
  return renderMarkdown(doc.md)
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="open" class="help-backdrop" @click.self="emit('close')">
    <div class="help-panel" role="dialog" aria-modal="true" aria-label="Help">
      <header class="help-head">
        <nav class="help-nav">
          <button
            v-for="d in DOCS"
            :key="d.id"
            :class="{ active: active === d.id }"
            @click="active = d.id"
          >
            {{ d.label }}
          </button>
        </nav>
        <button class="help-close" @click="emit('close')" aria-label="Close help">×</button>
      </header>
      <!-- Trusted, app-authored markdown rendered to HTML. -->
      <div class="help-body markdown" v-html="html"></div>
    </div>
  </div>
</template>

<style scoped>
.help-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 7, 14, 0.66);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: max(1rem, env(safe-area-inset-top)) 1rem 1rem;
  z-index: 50;
  overflow: auto;
}
.help-panel {
  width: min(46rem, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev, #121826);
  border: 1px solid var(--border);
  border-radius: var(--radius, 0.5rem);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.help-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
}
.help-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  flex: 1;
}
.help-nav button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 0.78rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius, 0.4rem);
  cursor: pointer;
}
.help-nav button:hover {
  color: var(--text);
  border-color: var(--border);
}
.help-nav button.active {
  color: var(--text);
  border-color: var(--accent-blue, #4f8ef7);
  background: var(--bg-elev-2, rgba(79, 142, 247, 0.1));
}
.help-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.3rem;
}
.help-close:hover {
  color: var(--text);
}
.help-body {
  padding: 0.4rem 1.1rem 1.2rem;
  overflow: auto;
}
</style>

<style>
/* Markdown content (not scoped, so it styles v-html output). */
.help-body.markdown {
  color: var(--text, #e7eaf3);
  line-height: 1.55;
  font-size: 0.9rem;
}
.help-body.markdown h1 {
  font-size: 1.25rem;
  margin: 0.8rem 0 0.5rem;
}
.help-body.markdown h2 {
  font-size: 1.05rem;
  margin: 1rem 0 0.4rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.2rem;
}
.help-body.markdown h3 {
  font-size: 0.95rem;
  margin: 0.8rem 0 0.3rem;
}
.help-body.markdown p {
  margin: 0.5rem 0;
}
.help-body.markdown ul,
.help-body.markdown ol {
  margin: 0.4rem 0;
  padding-left: 1.3rem;
}
.help-body.markdown li {
  margin: 0.25rem 0;
}
.help-body.markdown code {
  font-family: ui-monospace, monospace;
  font-size: 0.82em;
  background: rgba(127, 140, 170, 0.16);
  padding: 0.05rem 0.3rem;
  border-radius: 0.25rem;
}
.help-body.markdown pre {
  background: #060912;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  padding: 0.6rem 0.8rem;
  overflow: auto;
}
.help-body.markdown pre code {
  background: none;
  padding: 0;
  font-size: 0.8rem;
  line-height: 1.5;
}
.help-body.markdown a {
  color: var(--accent-blue, #4f8ef7);
}
.help-body.markdown hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1rem 0;
}
.help-body.markdown strong {
  color: var(--text, #fff);
}
</style>
