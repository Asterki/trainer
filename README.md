# Trainer

Trainer is a local-first routine builder and workout logger. Define a repeating
cycle of weeks, train the session in front of you, and log every set. Progress,
history and personal records are derived from those logs.

There is no account, no in-app AI and no reminder engine. Trainer is a
TypeScript single-page application deployed as static files, with a custom
service worker for offline use.

> The data layer, exercise catalogue, routine builder, daily logging loop,
> progress reports and read-only history are in place. The relay API and the
> full manual arrive in later stages.

---

## Getting started

```bash
pnpm install
pnpm dev           # http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm typecheck` | TypeScript only |
| `pnpm build` | Typecheck, then produce `dist/` |
| `pnpm preview` | Serve the production build |
| `node scripts/build-exercises.mjs` | Rebuild the committed wger catalogue (manual, needs network) |

The production build is a static SPA with a custom `public/sw.js` cache.
`vercel.json` supplies the SPA rewrite and service-worker headers.

## Data and attribution

Trainer keeps routines, sessions, custom exercises and settings in the local
IndexedDB database `trainer`. The seeded exercise catalogue is derived from
[wger](https://wger.de/) and committed as text-only JSON; the app bundle never
fetches the network at build time. See
[`src/domain/catalogue/ATTRIBUTION.md`](./src/domain/catalogue/ATTRIBUTION.md)
for the retrieval date, licenses and obligations.

The product contract and stage plan live in [`docs/stages/`](./docs/stages/).
