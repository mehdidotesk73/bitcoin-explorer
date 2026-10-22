<script setup lang="ts" generic="T extends string | number">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

// iOS-style vertical wheel picker: <WheelPicker v-model="unit" :options="..." />.
// Native scroll + CSS scroll-snap does the momentum and snapping (feels native
// on mobile Safari); we just read which row settled in the centre and emit it.
const props = defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const ITEM_H = 26 // px; keep in sync with --item-h below
const scroller = ref<HTMLElement>()
const scrollTop = ref(0)

const selectedIndex = computed(() =>
  Math.max(
    0,
    props.options.findIndex((o) => o.value === props.modelValue),
  ),
)

function scrollToIndex(i: number, smooth = true) {
  scroller.value?.scrollTo({ top: i * ITEM_H, behavior: smooth ? 'smooth' : 'auto' })
}

// Commit once scrolling settles. `scrollend` isn't everywhere yet (older
// Safari), so a short debounce on `scroll` covers both.
let settleTimer: ReturnType<typeof setTimeout> | undefined
let raf = 0
function onScroll() {
  if (!raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      scrollTop.value = scroller.value?.scrollTop ?? 0
    })
  clearTimeout(settleTimer)
  settleTimer = setTimeout(settle, 120)
}
function settle() {
  if (!scroller.value) return
  const i = Math.min(
    props.options.length - 1,
    Math.max(0, Math.round(scroller.value.scrollTop / ITEM_H)),
  )
  const opt = props.options[i]
  if (opt && opt.value !== props.modelValue) emit('update:modelValue', opt.value)
}

function step(delta: number) {
  const i = Math.min(props.options.length - 1, Math.max(0, selectedIndex.value + delta))
  scrollToIndex(i)
}

// Per-row drum effect from live scroll position: rows tilt and fade away from
// the centre line.
function itemStyle(i: number) {
  const d = i - scrollTop.value / ITEM_H
  const a = Math.min(Math.abs(d), 1.5)
  return {
    transform: `rotateX(${-d * 28}deg)`,
    opacity: String(1 - a * 0.45),
  }
}

watch(
  () => props.modelValue,
  () => {
    if (!scroller.value) return
    if (Math.round(scroller.value.scrollTop / ITEM_H) !== selectedIndex.value)
      scrollToIndex(selectedIndex.value)
  },
)

onMounted(() => {
  scrollToIndex(selectedIndex.value, false)
  scrollTop.value = scroller.value?.scrollTop ?? 0
})
onBeforeUnmount(() => {
  clearTimeout(settleTimer)
  cancelAnimationFrame(raf)
})
</script>

<template>
  <!-- click.prevent: the picker sits inside a <label>, whose default action
       would otherwise focus the neighbouring number input (popping the keyboard). -->
  <div
    class="wheel"
    role="listbox"
    tabindex="0"
    @click.prevent
    @keydown.up.prevent="step(-1)"
    @keydown.down.prevent="step(1)"
  >
    <ul ref="scroller" class="scroller" @scroll.passive="onScroll">
      <li
        v-for="(o, i) in options"
        :key="String(o.value)"
        role="option"
        :aria-selected="i === selectedIndex"
        :class="{ sel: i === selectedIndex }"
        :style="itemStyle(i)"
        @click="scrollToIndex(i)"
      >
        {{ o.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.wheel {
  --item-h: 26px;
  position: relative;
  height: calc(var(--item-h) * 3);
  min-width: 4.8rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  overflow: hidden;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
}
.wheel:focus-visible {
  border-color: var(--accent-blue);
}
/* Centre selection band. */
.wheel::after {
  content: '';
  position: absolute;
  left: 0.25rem;
  right: 0.25rem;
  top: var(--item-h);
  height: var(--item-h);
  border-top: 1px solid var(--border-strong);
  border-bottom: 1px solid var(--border-strong);
  pointer-events: none;
}
.scroller {
  list-style: none;
  margin: 0;
  padding: var(--item-h) 0;
  height: 100%;
  box-sizing: border-box;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  perspective: 160px;
  mask-image: linear-gradient(transparent, #000 35%, #000 65%, transparent);
  -webkit-mask-image: linear-gradient(transparent, #000 35%, #000 65%, transparent);
}
.scroller::-webkit-scrollbar {
  display: none;
}
li {
  height: var(--item-h);
  line-height: var(--item-h);
  text-align: center;
  scroll-snap-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
  cursor: pointer;
}
li.sel {
  color: var(--text);
}
</style>
