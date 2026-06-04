<script setup lang="ts">
import { computed, useSlots } from 'vue'

/**
 * Themed container with optional collapsibility — the one abstraction behind the
 * app's many bordered "panel" boxes (metric menu, forecast param sections, etc.).
 *
 * Variation axes (from the UI inventory in docs/TODO.md) are props, not per-call
 * CSS:
 *  - theme:        default | violet (accent edge + tint)
 *  - size:         regular | compact (padding)
 *  - collapsible:  none | header | face | icon
 *      header — tap the header row to collapse/expand (chevron + hint)
 *      face   — tap anywhere on the panel (outside the body) to toggle
 *      icon   — a trailing ⚙ button toggles the body (header stays visible)
 *  - collapsed:    v-model:collapsed for the open/closed state
 *
 * Slots: #header (replace the title/subtitle left side, e.g. a checkbox label),
 * #summary (shown in the header only while collapsed), #actions (trailing), and
 * the default slot for the body.
 */
const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    theme?: 'default' | 'violet'
    size?: 'regular' | 'compact'
    collapsible?: 'none' | 'header' | 'face' | 'icon'
    collapsed?: boolean
  }>(),
  {
    theme: 'default',
    size: 'regular',
    collapsible: 'none',
    collapsed: false,
  },
)
const emit = defineEmits<{ 'update:collapsed': [boolean] }>()
const slots = useSlots()

const canCollapse = computed(() => props.collapsible !== 'none')
const isCollapsed = computed(() => canCollapse.value && props.collapsed)
const headerTap = computed(() => props.collapsible === 'header' || props.collapsible === 'face')
const hasHeader = computed(
  () => !!(props.title || props.subtitle || slots.header || slots.actions || canCollapse.value),
)

function toggle() {
  if (canCollapse.value) emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <section
    class="panel"
    :class="[
      `theme-${theme}`,
      `size-${size}`,
      { collapsed: isCollapsed, 'face-tap': collapsible === 'face' },
    ]"
    @click="collapsible === 'face' ? toggle() : null"
  >
    <div
      v-if="hasHeader"
      class="panel-head"
      :class="{ tappable: headerTap }"
      @click="headerTap && collapsible !== 'face' ? toggle() : null"
    >
      <span v-if="headerTap" class="chev">{{ isCollapsed ? '▸' : '▾' }}</span>
      <slot name="header">
        <span v-if="title" class="panel-title">{{ title }}</span>
        <span v-if="subtitle" class="panel-subtitle">{{ subtitle }}</span>
      </slot>
      <span v-if="isCollapsed && slots.summary" class="panel-summary"><slot name="summary" /></span>
      <span v-if="headerTap" class="panel-hint">
        {{ isCollapsed ? 'tap to expand' : 'tap to collapse' }}
      </span>
      <slot name="actions" />
      <button
        v-if="collapsible === 'icon'"
        type="button"
        class="panel-gear"
        :class="{ open: !isCollapsed }"
        title="Configure"
        @click.stop="toggle"
      >
        ⚙
      </button>
    </div>
    <div v-show="!isCollapsed" class="panel-body" @click.stop>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid var(--border);
  background: var(--bg-elev);
  border-radius: var(--radius);
  margin-bottom: 0.8rem;
}
.panel.size-regular {
  padding: 0.7rem 0.9rem;
}
.panel.size-compact {
  padding: 0.4rem 0.6rem;
}
.panel.theme-violet {
  border-color: var(--accent-violet);
  background: var(--accent-violet-tint);
}
.panel.face-tap {
  cursor: pointer;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--accent-blue);
  font-size: 0.82rem;
  font-weight: 600;
}
.panel.theme-violet .panel-head {
  color: var(--accent-violet);
}
.panel-head.tappable {
  cursor: pointer;
  user-select: none;
}
.chev {
  font-size: 0.7rem;
}
.panel-subtitle {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.72rem;
}
.panel-summary {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.75rem;
  font-style: italic;
}
.panel-hint {
  margin-left: auto;
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.7rem;
  opacity: 0.7;
}
/* Gear toggle for collapsible="icon" panels. */
.panel-gear {
  margin-left: auto;
  background: none;
  border: none;
  padding: 0.1rem 0.2rem;
  font-size: 0.95rem;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
}
.panel-gear.open,
.panel-gear:hover {
  color: var(--accent-blue);
}

.panel-body {
  margin-top: 0.5rem;
}
/* A face-tap panel sets pointer cursor on the whole box; the body shouldn't
   inherit it (the body has @click.stop and holds real controls). */
.panel.face-tap .panel-body {
  cursor: auto;
}
/* Body that is hidden carries no top margin; header hugs the panel when folded,
   and a regular panel slims its vertical padding so a collapsed panel is barely
   taller than its header row. */
.panel.collapsed .panel-head {
  margin-bottom: 0;
}
.panel.size-regular.collapsed {
  padding-top: 0.4rem;
  padding-bottom: 0.4rem;
}
</style>
