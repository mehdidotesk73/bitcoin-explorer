import { ref, watch, type Ref } from 'vue'

// A ref that remembers its value in localStorage across reloads — a drop-in for
// `ref(initial)` on user settings. Each setting is its own key (no state blob or
// registry), validated on read so a stale or hand-edited value falls back to
// `initial` instead of breaking the view. Storage can be unavailable (private
// mode, blocked site data, tests) — then it's just a plain ref.

const PREFIX = 'btc-explorer:v1:'

/** Is `v` an acceptable stored value for a setting whose default is `initial`? */
export function isValidStored<T>(v: unknown, initial: T, allowed?: readonly T[]): v is T {
  if (allowed) return allowed.includes(v as T)
  if (typeof v !== typeof initial) return false
  return typeof v !== 'number' || Number.isFinite(v)
}

/** `storedRef('x', 0.15)` is a Ref<number>, not Ref<0.15>; string unions stay narrow. */
type Widen<T> = T extends number ? number : T extends boolean ? boolean : T

export function storedRef<T extends number | string | boolean>(
  key: string,
  initial: T,
  allowed?: readonly T[],
): Ref<Widen<T>> {
  const full = PREFIX + key
  let start = initial
  try {
    const raw = localStorage.getItem(full)
    if (raw != null) {
      const v: unknown = JSON.parse(raw)
      if (isValidStored(v, initial, allowed)) start = v
    }
  } catch {
    /* no storage / corrupt value → default */
  }
  const r = ref(start) as Ref<Widen<T>>
  watch(r, (v) => {
    try {
      localStorage.setItem(full, JSON.stringify(v))
    } catch {
      /* quota / no storage: keep working in memory */
    }
  })
  return r
}
