# test-git-claude-project

A **Vue 3 + Vite + TypeScript** web app that is installable as a **PWA** and
**Capacitor-ready** for native iOS/Android builds. One codebase, three delivery
targets: web → installable PWA → native app.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/ (also generates PWA assets)
npm run preview  # preview the production build locally
```

## Native-like experience (PWA)

`vite-plugin-pwa` generates a web manifest and service worker at build time, so
the app is **installable** ("Add to Home Screen" / "Install") and works offline.
App icons are generated from a single source SVG at `public/logo.svg` — run
`npm run generate-pwa-assets` to regenerate them after changing the logo.

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to `main`. Enable it once:

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The site goes live at
   `https://<owner>.github.io/test-git-claude-project/`.

The workflow sets `BASE_PATH=/<repo-name>/` so asset paths are correct for a
project page.

## Native apps (Capacitor)

Capacitor is pre-wired (`capacitor.config.ts`) but dormant — no native projects
are committed. To produce real store apps from the **same web build**:

```bash
npm run build
npm run cap:add:ios       # requires macOS + Xcode
npm run cap:add:android   # requires Android Studio
npm run cap:sync          # copy the latest web build into the native shells
```

Then open the generated `ios/` or `android/` project in Xcode / Android Studio
to run or publish.
