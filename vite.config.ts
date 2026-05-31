import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves project sites from /<repo-name>/.
// In CI we set BASE_PATH; locally and for Capacitor we use '/'.
const base = process.env.BASE_PATH ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      devOptions: {
        // Enables the service worker in `vite dev` for testing.
        enabled: false,
      },
    }),
  ],
})
