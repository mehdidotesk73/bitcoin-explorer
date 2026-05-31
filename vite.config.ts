import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves project sites from /<repo-name>/.
// In CI we set BASE_PATH; locally and for Capacitor we use '/'.
const base = process.env.BASE_PATH ?? '/'

// A build stamp so the running build is identifiable from a screenshot.
let buildId = 'dev'
try {
  buildId = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  /* not a git checkout */
}
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ')

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // Generate icons + favicons from a single source SVG.
      pwaAssets: {
        image: 'public/logo.svg',
      },
      manifest: {
        name: 'Bitcoin Price Explorer',
        short_name: 'BTC Explorer',
        description: 'Bitcoin price with moving average and Bollinger bands, adjustable.',
        theme_color: '#42b883',
        background_color: '#ffffff',
        display: 'standalone',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,csv}'],
      },
      devOptions: {
        // Enables the service worker in `vite dev` for testing.
        enabled: false,
      },
    }),
  ],
})
