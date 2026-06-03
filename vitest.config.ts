import { defineConfig } from 'vitest/config'

// Unit tests target the pure functions in src/lib (no DOM needed).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
