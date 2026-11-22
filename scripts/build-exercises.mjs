#!/usr/bin/env node
/**
 * Build the committed wger exercise catalogue.
 *
 *   node scripts/build-exercises.mjs
 *   node scripts/build-exercises.mjs --server-out ../server/src/trainer/wger-exercises.json
 *
 * Node 20+, no dependencies. The app build never runs this script and never
 * touches the network.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const API_URL = 'https://wger.de/api/v2/exerciseinfo/?language=2&limit=100';
const LICENSE_API = 'https://wger.de/api/v2/license/?limit=20';
const USER_AGENT = 'Trainer/0.1 (local-first workout catalogue build; https://wger.de)';
const PAGE_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRIES = 3;
const MAX_INSTRUCTIONS = 1200;
const MEDIA_CONCURRENCY = 4;
const MEDIA_BUDGET_BYTES = 30 * 1024 * 1024;
const execFile = promisify(execFileCallback);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'src/domain/catalogue/wger-exercises.json');
const ATTRIBUTION = resolve(ROOT, 'src/domain/catalogue/ATTRIBUTION.md');
const MEDIA_ROOT = resolve(ROOT, 'public/exercise-media');
const MEDIA_TMP = resolve(ROOT, 'public/.exercise-media-tmp');
const MEDIA_MANIFEST = resolve(ROOT, 'public/exercise-media-manifest.json');

const CATEGORY_MAP = new Map([
  ['abs', 'abs'],
  ['arms', 'arms'],
  ['back', 'back'],
  ['calves', 'calves'],
  ['chest', 'chest'],
  ['legs', 'legs'],
  ['shoulders', 'shoulders'],
  ['cardio', 'full-body'],
]);

const MUSCLE_MAP = new Map([
  ['anterior deltoid', 'anterior-deltoid'],
  ['posterior deltoid', 'posterior-deltoid'],
  ['biceps brachii', 'biceps-brachii'],
  ['biceps', 'biceps-brachii'],
  ['brachialis', 'brachialis'],
  ['triceps brachii', 'triceps-brachii'],
  ['triceps', 'triceps-brachii'],
  ['pectoralis major', 'pectoralis-major'],
  ['chest', 'pectoralis-major'],
  ['latissimus dorsi', 'latissimus-dorsi'],
  ['lats', 'latissimus-dorsi'],
  ['rhomboid', 'rhomboid'],
  ['rhomboids', 'rhomboid'],
  ['trapezius', 'trapezius'],
  ['serratus anterior', 'serratus-anterior'],
  ['erector spinae', 'erector-spinae'],
  ['rectus abdominis', 'rectus-abdominis'],
  ['abs', 'rectus-abdominis'],
  ['obliquus externus abdominis', 'obliquus-externus-abdominis'],
  ['gluteus maximus', 'gluteus-maximus'],
  ['glutes', 'gluteus-maximus'],
  ['quadriceps femoris', 'quadriceps-femoris'],
  ['quads', 'quadriceps-femoris'],
  ['biceps femoris', 'hamstrings'],
  ['hamstrings', 'hamstrings'],
  ['gastrocnemius', 'gastrocnemius'],
  ['calves', 'gastrocnemius'],
  ['soleus', 'soleus'],
]);

function equipmentId(name) {
  const key = name.trim().toLocaleLowerCase();
  if (key === 'barbell' || key === 'sz-bar' || key === 'ez-bar') return 'barbell';
  if (key === 'dumbbell') return 'dumbbell';
  if (key === 'cable machine' || key === 'cable') return 'cable';
  if (key === 'machine') return 'machine';
  if (key === 'kettlebell') return 'kettlebell';
  if (key === 'resistance band' || key === 'band') return 'band';
  if (key === 'none (bodyweight exercise)' || key === 'bodyweight' || key === 'pull-up bar') {
    return 'bodyweight';
  }
  return 'other';
}

function normalizeName(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function mappedMuscle(name, nameEn, unmapped) {
  for (const candidate of [name, nameEn]) {
    if (!candidate) continue;
    const mapped = MUSCLE_MAP.get(normalizeName(candidate));
    if (mapped) return mapped;
  }
  if (name) unmapped.add(name);
  if (nameEn && nameEn !== name) unmapped.add(nameEn);
  return null;
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
    frac12: '½',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLocaleLowerCase();
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return named[key] ?? match;
  });
}

function plainText(html) {
  if (!html) return '';
  const text = decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|ol|ul|div)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, MAX_INSTRUCTIONS).trim();
}

async function fetchPage(url) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === RETRIES) break;
      const wait = 1000 * 2 ** attempt;
      console.warn(`Fetch failed (${error.message}); retrying in ${wait}ms…`);
      await new Promise((resolveWait) => setTimeout(resolveWait, wait));
    }
  }
  throw new Error(`Could not fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}

async function fetchBinary(url) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === RETRIES) break;
      const wait = 1000 * 2 ** attempt;
      console.warn(`Download failed (${error.message}); retrying in ${wait}ms…`);
      await new Promise((resolveWait) => setTimeout(resolveWait, wait));
    }
  }
  throw new Error(`Could not download ${url}: ${lastError?.message ?? 'unknown error'}`);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function downloadMediaAsset(url, extension, wgerId, imageId) {
  const bytes = await fetchBinary(url);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const filename = `${imageId}-${hash}.${extension}`;
  const directory = resolve(MEDIA_TMP, String(wgerId));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, filename), bytes);
  return {
    path: `/exercise-media/${wgerId}/${filename}`,
    file: resolve(directory, filename),
    bytes: bytes.byteLength,
  };
}

function mediaExtension(url, fallback = 'png') {
  try {
    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
    return extension && /^(?:png|jpe?g|webp|gif|avif)$/.test(extension) ? extension : fallback;
  } catch {
    return fallback;
  }
}

async function extractGifStill(gifFile, wgerId, imageId) {
  const directory = resolve(MEDIA_TMP, String(wgerId));
  const temporary = resolve(directory, `${imageId}-still.png`);
  await execFile('ffmpeg', ['-y', '-v', 'error', '-i', gifFile, '-frames:v', '1', temporary]);
  const bytes = await readFile(temporary);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const filename = `${imageId}-${hash}.png`;
  await rename(temporary, resolve(directory, filename));
  return {
    path: `/exercise-media/${wgerId}/${filename}`,
    file: resolve(directory, filename),
    bytes: bytes.byteLength,
  };
}

async function buildMediaFor(exercise, name, wgerId, licenseMap) {
  const images = [...(exercise.images ?? [])].sort(
    (a, b) => Number(Boolean(b.is_main)) - Number(Boolean(a.is_main)) || a.id - b.id,
  );
  const media = [];
  let bytes = 0;
  let skipped = 0;
  let animatedCount = 0;

  for (const image of images) {
    const license = licenseMap.get(Number(image.license));
    if (!license) {
      skipped += 1;
      console.warn(`  skipped image ${image.id} for wger:${wgerId}: unknown license`);
      continue;
    }
    const animated = typeof image.image === 'string' && /\.gif(\?|$)/i.test(image.image);
    const thumbnailUrl = image.thumbnails?.small ?? image.thumbnails?.medium;
    const stillUrl = thumbnailUrl ?? (animated ? null : image.image);
    const sourceUrl = image.thumbnails?.medium ?? thumbnailUrl ?? image.image;
    let gif = null;
    if (animated) {
      gif = await downloadMediaAsset(image.image, 'gif', wgerId, image.id);
      bytes += gif.bytes;
    }

    const assets = new Map();
    async function assetFor(url) {
      if (!url) return null;
      if (!assets.has(url)) {
        assets.set(url, await downloadMediaAsset(url, mediaExtension(url), wgerId, image.id));
        bytes += assets.get(url).bytes;
      }
      return assets.get(url);
    }

    let still = null;
    if (stillUrl) {
      still = await assetFor(stillUrl);
    } else if (gif) {
      still = await extractGifStill(gif.file, wgerId, image.id);
      bytes += still.bytes;
    }
    if (!still) {
      skipped += 1;
      continue;
    }

    const source = gif ?? (await assetFor(sourceUrl));
    if (!source) {
      skipped += 1;
      continue;
    }

    const sequence = media.length + 1;
    const src = source.path;
    if (gif) animatedCount += 1;

    media.push({
      id: `wger:${image.id}`,
      thumb: still.path,
      src,
      animated,
      alt: `${name} demonstration${sequence > 1 ? ` ${sequence}` : ''}`,
      license: license.shortName,
      licenseUrl: license.url,
      author:
        image.license_author?.trim() ||
        image.author_history?.find((author) => author?.trim())?.trim() ||
        'wger contributor',
      sourceUrl: image.image,
    });
  }

  return { media, bytes, skipped, animatedCount };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function localIsoDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function main() {
  const retrievedAt = localIsoDate();
  const fetched = [];
  let url = API_URL;
  let page = 0;

  console.log(`Fetching ${API_URL}`);
  while (url) {
    const payload = await fetchPage(url);
    fetched.push(...payload.results);
    page += 1;
    console.log(`  page ${page}: ${payload.results.length} of ${payload.count}`);
    url = payload.next;
    if (url) await new Promise((resolveWait) => setTimeout(resolveWait, PAGE_DELAY_MS));
  }

  let droppedEnglish = 0;
  let droppedCategory = 0;
  let missingMuscles = 0;
  const unmappedMuscles = new Set();
  const unmappedEquipment = new Set();
  const missingEquipment = new Set();
  const categoryOverrides = new Set();
  const records = [];
  const licenses = new Map();

  for (const exercise of fetched) {
    const translation = (exercise.translations ?? []).find(
      (item) => item.language === 2 && typeof item.name === 'string' && item.name.trim(),
    );
    if (!translation) {
      droppedEnglish += 1;
      continue;
    }

    const license = exercise.license;
    if (license) {
      const key = `${license.short_name}|${license.full_name}|${license.url}`;
      const entry = licenses.get(key) ?? {
        shortName: license.short_name,
        fullName: license.full_name?.trim() ?? license.short_name,
        url: license.url,
        count: 0,
        authors: new Set(),
      };
      entry.count += 1;
      if (exercise.license_author) entry.authors.add(exercise.license_author);
      for (const author of exercise.author_history ?? []) {
        if (author) entry.authors.add(author);
      }
      licenses.set(key, entry);
    }

    const categoryName = exercise.category?.name ?? '';
    const category = CATEGORY_MAP.get(normalizeName(categoryName));
    if (!category) {
      droppedCategory += 1;
      if (categoryName) console.warn(`  unmapped category: ${categoryName}`);
      continue;
    }
    if (normalizeName(categoryName) === 'cardio') categoryOverrides.add('Cardio → Full body');

    const primary = [];
    for (const muscle of exercise.muscles ?? []) {
      const mapped = mappedMuscle(muscle.name, muscle.name_en, unmappedMuscles);
      if (mapped && !primary.includes(mapped)) primary.push(mapped);
    }
    const secondary = [];
    for (const muscle of exercise.muscles_secondary ?? []) {
      const mapped = mappedMuscle(muscle.name, muscle.name_en, unmappedMuscles);
      if (mapped && !primary.includes(mapped) && !secondary.includes(mapped)) secondary.push(mapped);
    }
    if (primary.length === 0) missingMuscles += 1;

    const equipment = [];
    const rawEquipment = exercise.equipment ?? [];
    if (rawEquipment.length === 0) missingEquipment.add(translation.name);
    for (const item of rawEquipment) {
      const mapped = equipmentId(item.name);
      if (mapped === 'other' && !['bench', 'incline bench', 'gym mat', 'swiss ball'].includes(normalizeName(item.name))) {
        unmappedEquipment.add(item.name);
      }
      if (!equipment.includes(mapped)) equipment.push(mapped);
    }
    if (equipment.length === 0) equipment.push('other');

    records.push({
      wgerId: exercise.id,
      name: translation.name.trim(),
      category,
      primary,
      secondary,
      equipment,
      instructions: plainText(translation.description),
    });
  }

  const rows = records.sort((a, b) => a.wgerId - b.wgerId);

  console.log(`\nFetching ${LICENSE_API}`);
  const licensePayload = await fetchPage(LICENSE_API);
  const mediaLicenses = new Map(
    licensePayload.results.map((license) => [
      Number(license.id),
      {
        shortName: license.short_name?.trim() || `License ${license.id}`,
        url: license.url,
      },
    ]),
  );

  const byWgerId = new Map(fetched.map((exercise) => [exercise.id, exercise]));
  let mediaBytes = 0;
  let mediaExercises = 0;
  let mediaImages = 0;
  let skippedImages = 0;
  let animatedImages = 0;

  const mediaPaths = new Set();
  await rm(MEDIA_TMP, { recursive: true, force: true });
  await mkdir(MEDIA_TMP, { recursive: true });
  try {
    await mapLimit(rows, MEDIA_CONCURRENCY, async (row) => {
      const source = byWgerId.get(row.wgerId);
      if (!source) return;
      const result = await buildMediaFor(source, row.name, row.wgerId, mediaLicenses);
      mediaBytes += result.bytes;
      skippedImages += result.skipped;
      animatedImages += result.animatedCount;
      if (result.media.length > 0) {
        row.media = result.media;
        mediaExercises += 1;
        mediaImages += result.media.length;
        for (const item of result.media) {
          mediaPaths.add(item.thumb);
          mediaPaths.add(item.src);
        }
      }
    });

    if (mediaBytes > MEDIA_BUDGET_BYTES) {
      throw new Error(
        `Media is ${(mediaBytes / 1024 / 1024).toFixed(1)}MB, over the ${MEDIA_BUDGET_BYTES / 1024 / 1024}MB budget.`,
      );
    }

    await rm(MEDIA_ROOT, { recursive: true, force: true });
    await rename(MEDIA_TMP, MEDIA_ROOT);
  } finally {
    await rm(MEDIA_TMP, { recursive: true, force: true });
  }

  const manifestFiles = [...mediaPaths].sort();
  await writeFile(
    MEDIA_MANIFEST,
    `${JSON.stringify({ version: retrievedAt, files: manifestFiles }, null, 2)}\n`,
    'utf8',
  );

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

  const otherOutput = argValue('--server-out');
  if (otherOutput) {
    const target = resolve(process.cwd(), otherOutput);
    const serverRows = rows.map(({ media: _media, ...row }) => row);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(serverRows, null, 2)}\n`, 'utf8');
    console.log(`Server copy: ${target}`);
  }

  const licenseRows = [...licenses.values()]
    .sort((a, b) => b.count - a.count)
    .map(
      (license) =>
        `- **${license.shortName}** — ${license.fullName}\n  - ${license.url}\n  - ${license.count} exercises; ${license.authors.size} recorded authors.`,
    );

  const mediaLicenseCounts = new Map();
  const imageCredits = [];
  for (const row of rows) {
    for (const item of row.media ?? []) {
      const key = `${item.license}|${item.licenseUrl}`;
      mediaLicenseCounts.set(key, (mediaLicenseCounts.get(key) ?? 0) + 1);
      imageCredits.push(
        `- **${row.name}** (wger:${row.wgerId}) — image ${item.id}, ${item.author}, [${item.license}](${item.licenseUrl}). [Source](${item.sourceUrl})`,
      );
    }
  }
  const mediaLicenseRows = [...mediaLicenseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const [shortName, url] = key.split('|');
      return `- **${shortName}** — ${url}\n  - ${count} images.`;
    });

  const attribution = `# Exercise catalogue and media attribution

The committed file \`wger-exercises.json\` contains exercise metadata and media
metadata derived from the public [wger](https://wger.de/) exercise database.
The committed files under \`public/exercise-media/\` are unmodified wger
images and, for five exercises, the original animated GIFs.

- **Source API:** ${API_URL}
- **Retrieved:** ${retrievedAt}
- **Exercises kept:** ${rows.length}
- **Exercises with media:** ${mediaExercises}
- **Bundled images:** ${mediaImages} (${animatedImages} animated GIFs)
- **Media size:** ${(mediaBytes / 1024 / 1024).toFixed(1)} MB
- **Videos:** not bundled. wger video files are outside this feature's scope.
- **Skipped images:** ${skippedImages} (missing thumbnail or unknown license)

## Licenses reported by wger for exercise text

${licenseRows.join('\n')}

## Licenses of bundled media

${mediaLicenseRows.join('\n')}

## Image credits

${imageCredits.join('\n')}

Exercise text and metadata are contributed by individual wger authors; the
author for each source exercise is recorded in the wger API. Attribution to
wger and those authors is retained here and in Trainer's Settings → About.

## Obligations

Where a license is **CC-BY-SA**, redistribution of the media must credit wger
and the original author(s), link to the license, and share adaptations under
the same license. The bundled images are unmodified thumbnails; the original
GIFs are unmodified. **CC0** records retain their respective terms. These
media obligations cover the images only; Trainer's application source remains
under its own terms.

## Body diagram

The male front/back body diagrams are rendered with
[@mjcdev/react-body-highlighter](https://www.npmjs.com/package/@mjcdev/react-body-highlighter)
0.0.4, MIT licensed, used directly as a runtime dependency.

## Changes made

- Kept every English translation with a mapped category.
- Mapped wger muscle and equipment names into Trainer's fixed taxonomy. The
  ${missingMuscles} exercises whose wger record has no muscles keep empty
  muscle lists rather than inventing anatomy.
- Converted descriptions to plain text and capped them at ${MAX_INSTRUCTIONS}
  characters.
- Downloaded the 400px wger render (200px fallback) for display and the
  200px thumbnail for compact surfaces, plus the original GIF when the
  source image is animated.
${categoryOverrides.size ? `- Category overrides: ${[...categoryOverrides].join(', ')}.\n` : ''}
`;
  await writeFile(ATTRIBUTION, attribution, 'utf8');

  console.log('\nCatalogue build report');
  console.log(`  fetched: ${fetched.length}`);
  console.log(`  kept: ${rows.length}`);
  console.log(`  dropped — no English name: ${droppedEnglish}`);
  console.log(`  dropped — unmapped category: ${droppedCategory}`);
  console.log(`  kept with no muscles in wger: ${missingMuscles}`);
  console.log(`  media exercises: ${mediaExercises}`);
  console.log(`  media images: ${mediaImages} (${animatedImages} GIFs, ${skippedImages} skipped)`);
  console.log(`  media size: ${(mediaBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  unmapped muscles: ${unmappedMuscles.size ? [...unmappedMuscles].sort().join(', ') : 'none'}`);
  console.log(`  unmapped equipment: ${unmappedEquipment.size ? [...unmappedEquipment].sort().join(', ') : 'none'}`);
  console.log(`  equipment absent (mapped to other): ${missingEquipment.size}`);
  if (categoryOverrides.size) console.log(`  category overrides: ${[...categoryOverrides].join(', ')}`);
  console.log(`\nWrote ${OUTPUT}`);
  console.log(`Wrote ${ATTRIBUTION}`);
}

main().catch((error) => {
  console.error(`Catalogue build failed: ${error.message}`);
  process.exitCode = 1;
});
