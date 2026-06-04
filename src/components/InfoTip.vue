<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { GLOSSARY } from '../lib/glossary'

// Reusable concept tooltip: <InfoTip term="ma" />. Looks the concept up in the
// shared glossary and shows a brief, tap-to-toggle popover (works on mobile, no
// hover needed). Renders nothing if the key is unknown.
const props = defineProps<{ term: string }>()
const entry = computed(() => GLOSSARY[props.term])

const open = ref(false)
const root = ref<HTMLElement>()

function toggle(e: MouseEvent) {
  e.stopPropagation()
  open.value = !open.value
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <span v-if="entry" ref="root" class="infotip">
    <button
      type="button"
      class="infotip-btn"
      :class="{ open }"
      :aria-label="`What is ${entry.term}?`"
      :aria-expanded="open"
      @click="toggle"
    >
      ?
    </button>
    <span v-if="open" class="infotip-pop" role="tooltip">
      <strong class="infotip-term">{{ entry.term }}</strong>
      <span class="infotip-def">{{ entry.def }}</span>
    </span>
  </span>
</template>

<style scoped>
.infotip {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
  margin-left: 0.25rem;
}
.infotip-btn {
  width: 1rem;
  height: 1rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.infotip-btn:hover,
.infotip-btn.open {
  color: var(--accent-blue, #4f8ef7);
  border-color: var(--accent-blue, #4f8ef7);
}
.infotip-pop {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  z-index: 60;
  width: max-content;
  max-width: min(20rem, 78vw);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0.6rem;
  background: var(--bg-elev, #121826);
  border: 1px solid var(--border);
  border-radius: var(--radius, 0.4rem);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  text-align: left;
  white-space: normal;
  cursor: auto;
}
.infotip-term {
  font-size: 0.78rem;
  color: var(--accent-blue, #4f8ef7);
}
.infotip-def {
  font-size: 0.76rem;
  line-height: 1.45;
  color: var(--text, #e7eaf3);
  font-weight: 400;
}
</style>
