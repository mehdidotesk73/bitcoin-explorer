import {
  defineConfig,
  minimal2023Preset as preset,
} from '@vite-pwa/assets-generator/config'

// Generates app icons, apple-touch-icon, favicons, and maskable icons
// from a single source SVG. Run `npm run generate-pwa-assets`, or let
// vite-plugin-pwa's `pwaAssets` option produce them at build time.
export default defineConfig({
  preset,
  images: ['public/logo.svg'],
})
