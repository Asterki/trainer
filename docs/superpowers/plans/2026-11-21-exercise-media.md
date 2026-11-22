# wger Exercise Media & Muscle Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show wger exercise photos and animated GIFs in the exercise picker and exercise detail, plus an offline front/back muscle diagram with primary and secondary muscles highlighted.

**Architecture:** Extend the existing committed-catalogue build so it also downloads wger's 200px thumbnails and the five original GIFs into `public/exercise-media/`, and records per-image license/author metadata on each catalogue row. A custom service-worker media cache keeps those local assets available offline. The body diagram is an inline SVG built from MIT-licensed polygon data, mapped to Trainer's muscle taxonomy, so it works without any download.

**Tech Stack:** React 18, TypeScript, Vite 6, Node 20 script using built-in `fetch`/`fs`/`crypto`, custom `public/sw.js` + Cache Storage, inline SVG, existing CSS tokens. No new runtime dependency.

**Spec:** `AGENTS.md`, `docs/stages/README.md`, and the user request dated 2026-11-21. This feature is explicitly listed as out of scope for v1 in `AGENTS.md`; the user has requested it directly, so it overrides that exclusion. This plan intentionally excludes video.

## License Decision

- wger exercise images/GIFs are exercise data, licensed per media record as CC-BY-SA 3.0, CC-BY-SA 4.0, or CC0 1.0. Redistributing the unmodified thumbnails is allowed with attribution and a license link for each image.
- wger's static muscle overlay SVGs are part of wger's AGPL-3.0 application code, not exercise data. **Do not copy them.**
- The full-body diagram vendors only the `anteriorData`/`posteriorData` polygon arrays from `react-body-highlighter@2.0.5`, which is MIT licensed. Keep its copyright notice in the source and in `ATTRIBUTION.md`. Do not add the package as a dependency; copy the data once.
- Do not redistribute wger videos. Their combined size is 3.57GB and they are outside this request.

## Global Constraints

- The app is local-first: every user action writes locally first; no screen waits on the network.
- Vite builds and `pnpm build` never fetch the network. Media is generated manually and committed.
- No new runtime dependency. The body polygon data is vendored source, not an npm dependency.
- No generic `utils.ts` or shared helper package. Put generation code in `scripts/`, catalogue mapping in `src/domain/catalogue`, UI in `src/components`, service-worker code in `public/sw.js`.
- No fake data, broken-image fallbacks, placeholder media, or dead controls.
- No wger video, no remote media URLs in the running app, no Vercel functions, no server API changes.
- Media cache names stay under the `trainer-*` namespace. Existing offline shell behaviour must continue.
- Touch targets remain at least 44×44px; no horizontal page scroll; support `prefers-reduced-motion`.
- Primary/secondary status must be communicated with text, not colour alone.
- No extensive automated tests. Verification is typecheck, production build, the builder's self-check, and the manual checklist below.

## Review Focus

1. **Exercises with zero media:** detail must render the diagram and instructions with no empty gallery, broken image, or shifted actions.
2. **Offline after a partial media sync:** the app boots; cached images render; uncached images fail silently; no unhandled promise rejection.
3. **Animated GIF with reduced motion:** the still thumbnail is shown when `prefers-reduced-motion: reduce`; otherwise the GIF animates.
4. **Catalogue regenerated with a changed image:** content-hashed filenames change, the service worker drops stale cache entries, and the new images appear after reload.
5. **Dark mode plus muscle-mapping gaps:** diagram remains legible, and approximate mappings for `serratus-anterior`, `brachialis`, and `rhomboid` still show a sensible region with the real muscle names in the legend.
6. **Custom exercise:** no wger media, but the diagram still renders from the custom primary/secondary muscles.

## File Structure

**Create**
- `public/exercise-media/**` — generated, committed thumbnail/GIF assets, one directory per wger exercise id.
- `public/exercise-media-manifest.json` — generated list of media paths for service-worker precache.
- `src/components/body/bodyPolygons.ts` — vendored MIT polygon data and `DiagramMuscle` type.
- `src/components/MuscleDiagram.tsx` — front/back SVG diagram and legend.
- `src/components/ExerciseMedia.tsx` — `ExerciseMediaGallery` and `ExerciseThumb`.

**Modify**
- `scripts/build-exercises.mjs` — download media, write metadata/manifest, update attribution.
- `src/domain/types.ts` — `ExerciseMedia`, `Exercise.media`.
- `src/domain/catalogue/wger.ts` — map media from catalogue rows.
- `src/components/ExerciseDetail.tsx` — gallery and diagram after the header.
- `src/components/ExercisePickerSheet.tsx` — 48px thumbnail in each result.
- `public/sw.js` — persistent media cache, precache message, media fetch route.
- `src/pwa/serviceWorker.ts` — ask the worker to cache media after registration.
- `vercel.json` — immutable media headers and no-cache manifest header.
- `src/views/SettingsView.tsx` — media and diagram attribution rows.
- `src/styles.css` — gallery, thumbnail, diagram styles.
- `src/domain/catalogue/wger-exercises.json` — regenerated with `media` arrays.
- `src/domain/catalogue/ATTRIBUTION.md` — regenerated with per-image credits and MIT notice.
- `README.md` — note that the catalogue command also downloads media.

No server source changes. If a server catalogue copy is generated with `--server-out`, strip `media` from that copy because the relay does not serve media.

---

### Task 1: Generate and commit wger media

**Files:**
- Modify: `scripts/build-exercises.mjs`
- Create/generated: `public/exercise-media/**`, `public/exercise-media-manifest.json`
- Modify/generated: `src/domain/catalogue/wger-exercises.json`
- Modify/generated: `src/domain/catalogue/ATTRIBUTION.md`

**Interfaces:**
- Consumes: wger `exerciseinfo` payload, including `images[].image`, `images[].thumbnails.small`, `images[].thumbnails.medium`, `images[].license`, `images[].license_author`, `images[].author_history`.
- Produces: each retained catalogue row may have `media: ExerciseMedia[]`; each public path is listed in `public/exercise-media-manifest.json` as `{ version: string, files: string[] }`.

- [ ] **Step 1: Add media constants and the license lookup**

In `scripts/build-exercises.mjs`, import `createHash` from `node:crypto` and `rm` from `node:fs/promises`. Add:

```js
const LICENSE_API = 'https://wger.de/api/v2/license/?limit=20';
const MEDIA_ROOT = resolve(ROOT, 'public/exercise-media');
const MEDIA_MANIFEST = resolve(ROOT, 'public/exercise-media-manifest.json');
```

Fetch the license payload once with the existing `fetchPage` helper and build a `Map<number, { shortName, url }>` keyed by license id. If an image has an unknown or missing license id, skip that image and log it. Do not guess a license or invent an author; `license_author` may be empty, in which case the caption uses “wger contributor”.

- [ ] **Step 2: Download retained media**

Add an async helper:

```js
async function buildMediaFor(exercise, name) // -> Promise<ExerciseMedia[]>
```

It must:

1. Sort `exercise.images` with `is_main` first, then `id` ascending.
2. Use `image.thumbnails.small ?? image.thumbnails.medium` as the still image. Skip an image when both are absent.
3. Detect an animated original when `image.image` ends in `.gif` (case-insensitive). Download the original GIF as well as the still thumbnail.
4. Download with the existing `REQUEST_TIMEOUT_MS`, retry policy, and `USER_AGENT`; run at most 4 downloads concurrently.
5. Hash the downloaded bytes with SHA-256 and use the first 10 hex characters in the filename:
   - still: `/exercise-media/<wgerId>/<imageId>-<hash>.png`
   - animated source: `/exercise-media/<wgerId>/<imageId>-<hash>.gif`
6. Return one metadata object per image:

```ts
interface ExerciseMedia {
  id: string;          // "wger:<imageId>"
  thumb: string;       // still PNG path
  src: string;         // GIF path when animated, otherwise the still PNG
  animated: boolean;
  alt: string;         // "<exercise name> demonstration" (+ " 2" for later images)
  license: string;     // "CC BY-SA 4.0", etc.
  licenseUrl: string;
  author: string;      // license_author, else first author_history entry, else "wger contributor"
  sourceUrl: string;   // image.image
}
```

- [ ] **Step 3: Attach media only to retained rows**

Download into a temporary directory (`public/.exercise-media-tmp`), not straight into the live directory. Only after every retained row has been processed successfully, remove `MEDIA_ROOT` and rename the temporary directory into place. This keeps the committed assets intact when a download fails.

Build a map of `wgerId -> fetched exercise`, then for each retained row download that row's media. Do not download media for rows dropped by language/category/muscle/dedupe rules. A duplicate-name collision keeps the lowest wger id, as today; do not merge media from the discarded duplicate.

Write the refreshed rows to `wger-exercises.json`, preserving the existing field order before `media`. Write `public/exercise-media-manifest.json` with every generated public path, sorted, and `version: retrievedAt`.

If `--server-out` is supplied, strip `media` from those rows before writing the server copy.

- [ ] **Step 4: Report and enforce a media budget**

Log: retained exercises with media, image count, GIF count, total downloaded bytes, and skipped images. Fail the script if total media exceeds **15MB**; the expected small-thumbnail budget is about 10MB including GIF originals. Fail on any failed download rather than writing a partial catalogue.

- [ ] **Step 5: Regenerate media and attribution**

Run:

```bash
node scripts/build-exercises.mjs
```

Expected: 813 retained exercises, roughly 250 exercises with media, roughly 356 images, 5 GIFs, and a media directory under 15MB. `ATTRIBUTION.md` must now say that images are bundled, list the image licenses and counts, include a per-image credit line with exercise name, image id, author, license, and source URL, and include the MIT body-diagram notice below.

- [ ] **Step 6: Verify every manifest path exists**

Run this one-off self-check:

```bash
node --input-type=module -e "import fs from 'node:fs'; const rows=JSON.parse(fs.readFileSync('src/domain/catalogue/wger-exercises.json')); const media=rows.flatMap(r=>r.media??[]); for (const m of media){ for (const p of [m.src,m.thumb]) if(!fs.existsSync('public'+p)) throw new Error(p); } const manifest=JSON.parse(fs.readFileSync('public/exercise-media-manifest.json')); if(!manifest.files.length) throw new Error('empty manifest'); console.log(media.length,'media rows;',manifest.files.length,'files');"
```

Expected: every path exists; non-zero counts.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-exercises.mjs src/domain/catalogue/wger-exercises.json src/domain/catalogue/ATTRIBUTION.md public/exercise-media public/exercise-media-manifest.json README.md
git commit -m "feat: bundle wger exercise media for offline use"
```

---

### Task 2: Add media types and catalogue mapping

**Files:**
- Modify: `src/domain/types.ts:53-65`
- Modify: `src/domain/catalogue/wger.ts:11-62`

**Interfaces:**
- Consumes: generated `media` arrays from Task 1.
- Produces: `ExerciseMedia` exported from `src/domain/types.ts`; `Exercise.media?: ExerciseMedia[]`; seeded exercises carry media, custom exercises do not.

- [ ] **Step 1: Add the type**

In `src/domain/types.ts`, add the `ExerciseMedia` interface exactly as in Task 1's interface block, then add to `Exercise`:

```ts
media?: ExerciseMedia[]; // seeded catalogue only
```

- [ ] **Step 2: Map it in the catalogue**

In `src/domain/catalogue/wger.ts`:

- Import `ExerciseMedia`.
- Add `media?: ExerciseMedia[]` to `CatalogueRow`.
- In `fromRow`, add `media: row.media` after `instructions`.
- Leave `loadCatalogue`, search, and custom merging unchanged. Custom exercises have no `media`, so no database migration is needed.

- [ ] **Step 3: Verify**

```bash
pnpm typecheck
```

Expected: pass. `Exercise` literals in session snapshots do not need media because sessions store only the exercise id, name, and muscle snapshot.

- [ ] **Step 4: Commit**

```bash
git add src/domain/types.ts src/domain/catalogue/wger.ts
git commit -m "feat: expose exercise media metadata"
```

---

### Task 3: Build the offline muscle diagram

**Files:**
- Create: `src/components/body/bodyPolygons.ts`
- Create: `src/components/MuscleDiagram.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `MuscleGroupId` from `src/domain/types.ts`, `MUSCLE_GROUP_LABELS` from `src/domain/catalogue/groups.ts`.
- Produces: `MuscleDiagram({ primary, secondary }: { primary: MuscleGroupId[]; secondary: MuscleGroupId[] })`.

- [ ] **Step 1: Vendor the MIT polygon data**

Create `src/components/body/bodyPolygons.ts` with this header:

```ts
/**
 * Body polygon data from react-body-highlighter 2.0.5.
 * Copyright (c) 2020 GV79. MIT licensed. See ATTRIBUTION.md.
 */
```

Copy the `anteriorData` and `posteriorData` arrays from
`https://unpkg.com/react-body-highlighter@2.0.5/dist/react-body-highlighter.cjs.development.js`,
dropping the React code and keeping only:

```ts
export type DiagramMuscle =
  | 'chest' | 'obliques' | 'abs' | 'biceps' | 'triceps' | 'neck'
  | 'front-deltoids' | 'back-deltoids' | 'trapezius' | 'upper-back'
  | 'lower-back' | 'forearm' | 'gluteal' | 'quadriceps' | 'hamstring'
  | 'calves' | 'left-soleus' | 'right-soleus' | 'knees' | 'head'
  | 'abductors' | 'adductor';

export interface BodyPolygon {
  muscle: DiagramMuscle;
  points: string[];
}

export const ANTERIOR_POLYGONS: BodyPolygon[] = [/* copied anteriorData */];
export const POSTERIOR_POLYGONS: BodyPolygon[] = [/* copied posteriorData */];
```

The source uses `viewBox="0 0 100 200"`. Keep that exact geometry.

- [ ] **Step 2: Map Trainer muscles to diagram regions**

In `src/components/MuscleDiagram.tsx`, define:

```ts
const FRONT_MAP: Partial<Record<MuscleGroupId, DiagramMuscle[]>> = {
  'anterior-deltoid': ['front-deltoids'],
  'biceps-brachii': ['biceps'],
  'brachialis': ['biceps'],
  'pectoralis-major': ['chest'],
  'serratus-anterior': ['obliques'],
  'rectus-abdominis': ['abs'],
  'obliquus-externus-abdominis': ['obliques'],
  'quadriceps-femoris': ['quadriceps'],
  'gastrocnemius': ['calves'],
  'soleus': ['left-soleus', 'right-soleus'],
};

const BACK_MAP: Partial<Record<MuscleGroupId, DiagramMuscle[]>> = {
  'posterior-deltoid': ['back-deltoids'],
  'triceps-brachii': ['triceps'],
  'latissimus-dorsi': ['upper-back'],
  'rhomboid': ['upper-back'],
  'trapezius': ['trapezius'],
  'erector-spinae': ['lower-back'],
  'gluteus-maximus': ['gluteal'],
  'hamstrings': ['hamstring'],
  'gastrocnemius': ['calves'],
  'soleus': ['left-soleus', 'right-soleus'],
};
```

Build a set of primary and secondary diagram regions for each view. A region that is primary wins over secondary.

- [ ] **Step 3: Render accessible front/back figures**

Render a `<figure className="muscle-diagram">` containing two `<svg viewBox="0 0 100 200" role="img">` elements. Each SVG maps its polygon array to `<polygon>` with:

```tsx
className={
  primarySet.has(item.muscle)
    ? 'muscle-diagram__primary'
    : secondarySet.has(item.muscle)
      ? 'muscle-diagram__secondary'
      : 'muscle-diagram__body'
}
```

Give the figure an `aria-label` of `Front and back muscle diagram. Primary: … Secondary: …` using `MUSCLE_GROUP_LABELS`. Add a visible `<figcaption>` legend with the text “Primary” and “Secondary” and the muscle names; hide the legend text from the SVG duplicate with `aria-hidden="true"` on each SVG's decorative parts only if the figcaption carries all information.

Do not render anything when both muscle lists are empty.

- [ ] **Step 4: Style it**

In `src/styles.css`, add tokens if not already present:

```css
--muscle-body: #d0d7de;
--muscle-primary: #cf222e;
--muscle-secondary: #bf8700;
```

and dark equivalents with sufficient contrast. The diagram is two columns, max 140px per figure, centred, with no horizontal scroll. Put a neutral light panel behind the SVG in both themes so the silhouette keeps contrast. Use 44px minimum touch targets only if the diagram is interactive; this diagram is not interactive.

- [ ] **Step 5: Verify**

```bash
pnpm typecheck
```

Expected: pass. No network request is made by the component.

- [ ] **Step 6: Commit**

```bash
git add src/components/body/bodyPolygons.ts src/components/MuscleDiagram.tsx src/styles.css
git commit -m "feat: add offline muscle diagram"
```

---

### Task 4: Add the media gallery and thumbnails

**Files:**
- Create: `src/components/ExerciseMedia.tsx`
- Modify: `src/components/ExerciseDetail.tsx:154-196`
- Modify: `src/components/ExercisePickerSheet.tsx:161-208`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `Exercise` with optional `media`; `useMediaQuery` from `src/state/hooks`.
- Produces: `ExerciseMediaGallery({ exercise }: { exercise: Exercise })` and `ExerciseThumb({ exercise }: { exercise: Exercise })`.

- [ ] **Step 1: Create the gallery and thumb components**

`ExerciseMediaGallery` returns `null` when `exercise.media` is empty. Otherwise render a `.exercise-media` card with one figure per image:

- `<img src={item.src} alt={item.alt} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" />`.
- When `useMediaQuery('(prefers-reduced-motion: reduce)')` is true and `item.animated`, use `item.thumb` instead of `item.src`.
- Caption: `item.author`, a link to `item.sourceUrl`, `·`, and a link to `item.licenseUrl` with `item.license` as the text. Add a text `GIF` badge for animated entries.
- Use a stable `key={item.id}`.

`ExerciseThumb` returns `null` when there is no media. Otherwise render a 48×48 `<img className="exercise-thumb" src={item.thumb} alt="" loading="lazy" decoding="async" />`. It is decorative because the adjacent row already names the exercise.

- [ ] **Step 2: Insert into ExerciseDetail**

After the custom-exercise edit paragraph and before the instructions `<details>`, add:

```tsx
{catalogueExercise ? <ExerciseMediaGallery exercise={catalogueExercise} /> : null}
<MuscleDiagram primary={primaryMuscles} secondary={secondaryMuscles} />
```

`MuscleDiagram` returns `null` when both muscle lists are empty, so a custom exercise with no muscles never leaves a blank block. If `catalogueExercise` is undefined but `latestRow` supplies muscles, the diagram still renders from those muscles and the gallery stays hidden.

- [ ] **Step 3: Insert the picker thumbnail**

In `ExercisePickerSheet`, inside the result `<button>`, render `<ExerciseThumb exercise={exercise} />` before `picker__result-main`. Keep the existing name/meta layout and add state beside it. No thumbnail means no empty box.

- [ ] **Step 4: Style gallery and thumb**

Add CSS:

```css
.exercise-media__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.exercise-media__item img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.exercise-thumb {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  object-fit: cover;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}
```

Adjust the picker result to `display:flex; align-items:center; gap:10px` if it is not already. Keep the row's touch height at least 44px and do not let a thumbnail compress the text below readable width.

- [ ] **Step 5: Verify**

```bash
pnpm typecheck
pnpm build
```

Open an exercise with photos and one without. The gallery must not appear for custom exercises, and no broken image should render. This is also the first check that Vite copied `public/exercise-media` into `dist`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ExerciseMedia.tsx src/components/ExerciseDetail.tsx src/components/ExercisePickerSheet.tsx src/styles.css
git commit -m "feat: show exercise photos, gifs, and muscle diagrams"
```

---

### Task 5: Make media available offline

**Files:**
- Modify: `public/sw.js`
- Modify: `src/pwa/serviceWorker.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `/exercise-media-manifest.json` from Task 1.
- Produces: stable Cache Storage bucket `trainer-media-v1`; SW message `{ type: 'cache-media' }`.

- [ ] **Step 1: Add the persistent media cache**

In `public/sw.js`:

```js
const MEDIA_CACHE = 'trainer-media-v1';
const MEDIA_MANIFEST = '/exercise-media-manifest.json';
```

Exclude `MEDIA_CACHE` from the activation cleanup, alongside the current shell/runtime caches. Keep deleting legacy `tasker-*` and other `trainer-*` caches.

- [ ] **Step 2: Add precache and stale-entry cleanup**

Add:

```js
async function precacheMedia() { /* fetch manifest, cache missing files in batches of 8, delete cache entries not in manifest */ }
```

Rules:

- Fetch the manifest with `{ cache: 'no-store' }`.
- If the manifest is unavailable, return without throwing; the next launch retries.
- Compare cached request paths to `manifest.files`; only download missing files.
- Use batches of 8 and `Promise.allSettled` so one bad file does not abort the rest.
- After caching, delete entries whose path is no longer in the manifest. This handles content-hash changes.
- Never delete `MEDIA_CACHE` itself during this cleanup.

Call `precacheMedia()` from `activate` after `clients.claim()` using `event.waitUntil`, and also handle:

```js
self.addEventListener('message', (event) => {
  if (event.data?.type === 'cache-media') event.waitUntil(precacheMedia());
});
```

- [ ] **Step 3: Serve media cache-first**

Before the generic same-origin cache-first handler, add:

```js
if (url.pathname.startsWith('/exercise-media/')) {
  event.respondWith(
    caches.open(MEDIA_CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }),
  );
  return;
}
```

Return `Response.error()` if both cache and network fail, matching the app's existing offline behaviour. Do not put media in `RUNTIME_CACHE`.

- [ ] **Step 4: Ask the worker to prefetch after registration**

In `src/pwa/serviceWorker.ts`, after a successful registration:

```ts
const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
void navigator.serviceWorker.ready.then((ready) => {
  ready.active?.postMessage({ type: 'cache-media' });
});
return registration;
```

Do not block app boot on this promise.

- [ ] **Step 5: Add Vercel headers**

In `vercel.json`, add:

```json
{
  "source": "/exercise-media-manifest.json",
  "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
},
{
  "source": "/exercise-media/(.*)",
  "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
}
```

The manifest path is deliberately outside `/exercise-media/` so the immutable rule cannot cache it.

- [ ] **Step 6: Verify**

```bash
pnpm build
```

Serve the production build, open DevTools → Application → Cache Storage. Expected: `trainer-media-v1` appears after the app loads and fills with images. Switch DevTools to Offline, reload, and open an exercise: cached photos, GIFs, and the inline diagram must render. A never-cached image must not break the page.

- [ ] **Step 7: Commit**

```bash
git add public/sw.js src/pwa/serviceWorker.ts vercel.json
git commit -m "feat: cache exercise media offline"
```

---

### Task 6: Attribution, Settings, and final gate

**Files:**
- Modify: `src/views/SettingsView.tsx` (About section)
- Modify/generated: `src/domain/catalogue/ATTRIBUTION.md`
- Modify: `README.md`
- Verify: full app and server builds

**Interfaces:**
- Consumes: generated media metadata and the MIT polygon notice.
- Produces: user-visible attribution rows and the final acceptance checklist.

- [ ] **Step 1: Add Settings attribution rows**

In the About list, add:

- **Exercise media** — “wger — CC BY-SA 4.0 / 3.0 / CC0; individual credits shown with each image.”
- **Body diagram** — “react-body-highlighter — MIT.”

Keep the existing catalogue row and the wger link. Do not add a help paragraph or a new icon.

- [ ] **Step 2: Confirm generated attribution**

`ATTRIBUTION.md` must include:

- The media counts and total size.
- A per-image credit line with exercise name, wger image id, author, license, and source URL.
- The CC-BY-SA share-alike note covering the media only; state that the application source remains under its own terms.
- The MIT notice for `react-body-highlighter` polygon data.
- An explicit “videos not bundled” line.

- [ ] **Step 3: Update the README**

Change the catalogue command description to note that it also downloads and commits exercise media, and that it requires network access. Keep the build/network constraint text.

- [ ] **Step 4: Run the full gate**

```bash
pnpm typecheck
pnpm build
pnpm --dir server typecheck
pnpm --dir server build
```

Expected: all pass. `dist` must contain `exercise-media/` and `exercise-media-manifest.json`; the app's main JS chunk must not grow by the media payload.

- [ ] **Step 5: Run the manual checklist**

Desktop and a narrow mobile viewport:

- Open an exercise with one image, one with multiple images, one with a GIF, and one with no images.
- Confirm the gallery, GIF/static behaviour, captions, license links, and diagram all render.
- Toggle reduced motion; confirm the GIF becomes its still thumbnail.
- Toggle dark mode; confirm the silhouette, primary/secondary fills, and legend text remain legible.
- Open a custom exercise; confirm no media gallery and a diagram from its muscles.
- Open the picker; confirm thumbnails appear only where media exists and rows stay aligned.
- Go offline after the media cache has filled; reload, then open the same exercises. Confirm photos, GIFs, and diagrams work.
- Simulate a first-ever offline load: the shell still boots, no broken-image icon appears, and the inline diagram still renders.
- Confirm no horizontal page scroll and no touch target below 44px.

- [ ] **Step 6: Commit**

```bash
git add src/views/SettingsView.tsx src/domain/catalogue/ATTRIBUTION.md README.md
git commit -m "docs: credit exercise media and body diagram"
```

## Self-Review Notes

- Spec coverage: images, animated GIFs, per-exercise body diagram, offline behaviour, attribution, dark mode, reduced motion, missing media, custom exercises, and cache invalidation all have tasks.
- Out of scope made explicit: wger videos, server changes, and AGPL wger muscle overlays.
- Type names are consistent across tasks: `ExerciseMedia`, `Exercise.media`, `BodyPolygon`, `DiagramMuscle`, `MuscleDiagram`, `ExerciseMediaGallery`, `ExerciseThumb`.
- No task adds a runtime dependency or writes tests beyond the repository's gate and manual checklist.
- Optional server catalogue output deliberately strips `media`; no server code change is required.
- The media cache is stable across builds and garbage-collects old content-hashed files; the manifest is no-cache while hashed assets are immutable.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-21-exercise-media.md`.

This plan touches the catalogue build, client types, detail/picker UI, service worker, and deployment headers, so the tasks depend on each other's exact interfaces. Read the license decision before starting.

Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements and reviews each task before the next. Best when the media build and service-worker cache should be reviewed independently.
- **Native** — I implement the tasks in this session and run one final review. Faster, but the build script, UI, and offline cache land without independent review.

I recommend **subagent-driven** for this plan because the generated-asset step and the service-worker cache are the two places a subtle mistake would leave the app looking correct online while failing offline.
