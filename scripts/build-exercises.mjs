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

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://wger.de/api/v2/exerciseinfo/?language=2&limit=100';
const USER_AGENT = 'Trainer/0.1 (local-first workout catalogue build; https://wger.de)';
const PAGE_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRIES = 3;
const MAX_INSTRUCTIONS = 1200;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'src/domain/catalogue/wger-exercises.json');
const ATTRIBUTION = resolve(ROOT, 'src/domain/catalogue/ATTRIBUTION.md');

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
  let droppedMuscles = 0;
  let droppedDuplicate = 0;
  const unmappedMuscles = new Set();
  const unmappedEquipment = new Set();
  const missingEquipment = new Set();
  const duplicateNames = [];
  const categoryOverrides = new Set();
  const byName = new Map();
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
    if (primary.length === 0) {
      droppedMuscles += 1;
      continue;
    }

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

    const normalized = normalizeName(translation.name);
    const record = {
      wgerId: exercise.id,
      name: translation.name.trim(),
      category,
      primary,
      secondary,
      equipment,
      instructions: plainText(translation.description),
    };
    const existing = byName.get(normalized);
    if (existing) {
      duplicateNames.push(`${existing.name} (wger:${existing.wgerId}) ↔ ${record.name} (wger:${record.wgerId})`);
      droppedDuplicate += 1;
      if (record.wgerId < existing.wgerId) byName.set(normalized, record);
    } else {
      byName.set(normalized, record);
    }
  }

  const rows = [...byName.values()].sort((a, b) => a.wgerId - b.wgerId);
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

  const otherOutput = argValue('--server-out');
  if (otherOutput) {
    const target = resolve(process.cwd(), otherOutput);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    console.log(`Server copy: ${target}`);
  }

  const licenseRows = [...licenses.values()]
    .sort((a, b) => b.count - a.count)
    .map(
      (license) =>
        `- **${license.shortName}** — ${license.fullName}\n  - ${license.url}\n  - ${license.count} exercises; ${license.authors.size} recorded authors.`,
    );

  const attribution = `# Exercise catalogue attribution

The committed file \`wger-exercises.json\` contains text-only exercise metadata
derived from the public [wger](https://wger.de/) exercise database.

- **Source API:** ${API_URL}
- **Retrieved:** ${retrievedAt}
- **Exercises kept:** ${rows.length}
- **Images/videos:** none. No wger media is bundled or redistributed.

## Licenses reported by wger

${licenseRows.join('\n')}

Exercise text and metadata are contributed by individual wger authors; the
author for each source exercise is recorded in the wger API. Attribution to
wger and those authors is retained here and in Trainer's Settings → About.

## Obligations

Where a license is **CC-BY-SA**, redistribution of the derived catalogue must
credit wger and the original author(s), link to the license, indicate changes
(the text is HTML-stripped, capped and mapped into Trainer's taxonomy), and
share adaptations under the same license. **CC0** and **ODbL** records retain
their respective terms. Trainer is a personal, non-commercial application and
does not bundle wger images.

## Changes made

- Kept English translations with a category and at least one mapped primary
  muscle.
- Mapped wger muscle and equipment names into Trainer's fixed taxonomy.
- Deduplicated by case/punctuation-insensitive name, keeping the lowest wger id.
- Converted descriptions to plain text and capped them at ${MAX_INSTRUCTIONS}
  characters.
${categoryOverrides.size ? `- Category overrides: ${[...categoryOverrides].join(', ')}.\n` : ''}
`;
  await writeFile(ATTRIBUTION, attribution, 'utf8');

  console.log('\nCatalogue build report');
  console.log(`  fetched: ${fetched.length}`);
  console.log(`  kept: ${rows.length}`);
  console.log(`  dropped — no English name: ${droppedEnglish}`);
  console.log(`  dropped — unmapped category: ${droppedCategory}`);
  console.log(`  dropped — no mapped primary muscle: ${droppedMuscles}`);
  console.log(`  dropped — duplicate names: ${droppedDuplicate}`);
  console.log(`  unmapped muscles: ${unmappedMuscles.size ? [...unmappedMuscles].sort().join(', ') : 'none'}`);
  console.log(`  unmapped equipment: ${unmappedEquipment.size ? [...unmappedEquipment].sort().join(', ') : 'none'}`);
  console.log(`  equipment absent (mapped to other): ${missingEquipment.size}`);
  if (categoryOverrides.size) console.log(`  category overrides: ${[...categoryOverrides].join(', ')}`);
  if (duplicateNames.length) {
    console.log('  duplicate name collisions:');
    for (const line of duplicateNames) console.log(`    ${line}`);
  }
  console.log(`\nWrote ${OUTPUT}`);
  console.log(`Wrote ${ATTRIBUTION}`);
}

main().catch((error) => {
  console.error(`Catalogue build failed: ${error.message}`);
  process.exitCode = 1;
});
