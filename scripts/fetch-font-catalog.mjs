#!/usr/bin/env node
// Downloads the Google Fonts metadata and writes the compact catalog that the font picker reads.
// Usage: node scripts/fetch-font-catalog.mjs
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://fonts.google.com/metadata/fonts';
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/app/fonts/catalog.json');

const CATEGORIES = {
  'sans serif': 'sans-serif',
  serif: 'serif',
  display: 'display',
  handwriting: 'handwriting',
  monospace: 'monospace',
};

/** Icon and emoji families draw symbols, not letters. */
const SKIP = /^(Material |Noto Color Emoji|Noto Emoji)/;

function fail(message) {
  console.error(`fetch-font-catalog: ${message}`);
  process.exit(1);
}

async function download() {
  let response;
  try {
    response = await fetch(SOURCE, { headers: { accept: 'application/json' } });
  } catch (error) {
    fail(`the request to ${SOURCE} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) fail(`${SOURCE} answered ${response.status} ${response.statusText}`);
  // The endpoint can start with an anti-JSON-hijacking prefix.
  const text = (await response.text()).replace(/^\)\]\}'\s*/, '');
  try {
    return JSON.parse(text);
  } catch {
    fail('the answer is not JSON');
  }
}

function styles(fonts) {
  const weights = new Set();
  const italics = new Set();
  for (const key of Object.keys(fonts ?? {})) {
    const match = /^(\d{3})(i?)$/.exec(key);
    if (!match) continue;
    (match[2] ? italics : weights).add(Number(match[1]));
  }
  const sorted = (set) => [...set].sort((a, b) => a - b);
  return { weights: sorted(weights), italics: sorted(italics) };
}

const metadata = await download();
const list = metadata?.familyMetadataList;
if (!Array.isArray(list) || list.length === 0) fail('the answer has no familyMetadataList');

const families = [];
for (const entry of list) {
  const family = typeof entry?.family === 'string' ? entry.family.trim() : '';
  if (!family || SKIP.test(family)) continue;
  const category = CATEGORIES[String(entry.category ?? '').toLowerCase()] ?? 'display';
  const { weights, italics } = styles(entry.fonts);
  if (weights.length === 0 && italics.length === 0) continue;
  const popularity = Number.isFinite(entry.popularity) ? entry.popularity : Number.MAX_SAFE_INTEGER;
  families.push({ family, category, weights, italics, popularity });
}

// Google ranks popularity from 1 (most used); the catalog keeps that order and a dense rank.
families.sort((a, b) => a.popularity - b.popularity || a.family.localeCompare(b.family));
const catalog = families.map(({ family, category, weights, italics }, index) => ({ family, category, weights, italics, rank: index + 1 }));

await writeFile(OUTPUT, `${JSON.stringify(catalog)}\n`);
console.log(`fetch-font-catalog: wrote ${catalog.length} families to ${OUTPUT}`);
