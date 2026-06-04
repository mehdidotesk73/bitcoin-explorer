# bitcoin1460

A **Vue 3 + TypeScript + Vite** single-page app for exploring **Bitcoin daily
price** history. All maths runs client-side over an already-fetched price array,
so every control recomputes instantly with no refetch. It ships as an installable
**PWA** (offline-capable) and is deployed to GitHub Pages.

Three tabs:

- **Price Explorer** — raw price plus toggleable technical metrics (moving
  average, Bollinger bands, run detection) and derived curves (price ÷ MA,
  Bollinger score, run slope). A descriptive lens on history.
- **Price Mechanics** — a structured *what-if* forecast engine: it splits price
  into a slow "value" baseline and a "volatility" multiplier, fits
  growth/volatility/peak models to history, and projects forward to a horizon.
- **Hodl Explorer** — a buying-strategy sandbox: build buy-day "seed layers" from
  tunable pattern pickers and compare the resulting position against a
  buy-every-day baseline over the same budget and window.

Indicators are **descriptive heuristics, not financial advice.**

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check (vue-tsc) + production build into dist/
npm run preview    # preview the production build locally
npm run test:run   # unit tests (Vitest)
```

> The price API is host-allowlisted and not reachable from every sandbox; the
> deployed app and on-device previews are the source of truth for data-dependent
> behaviour.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to **GitHub Pages** on every
push to `main` (`Settings → Pages → Source: GitHub Actions`). It sets
`BASE_PATH=/<repo-name>/` for correct project-page asset paths. **Netlify**
(`netlify.toml`) provides per-PR/branch deploy previews for on-phone testing.

## Docs

- [`CLAUDE.md`](./CLAUDE.md) — development lifecycle and conventions.
- [`docs/system-design.md`](./docs/system-design.md) — developer/system docs.
- [`docs/concepts/*.md`](./docs/concepts) — per-page user docs (also rendered in
  the in-app Help).
- [`docs/TODO.md`](./docs/TODO.md) — backlog, including the **delivery & native
  targets** (installable-PWA polish and the dormant Capacitor iOS/Android shells)
  for down the line.
