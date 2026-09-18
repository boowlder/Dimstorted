/**
 * Cache disque des index libretro.
 *
 * Les listes de jaquettes (jusqu'a 4 Mo de HTML) et les bases de metadonnees
 * ne changent qu'au rythme des contributions. On les telecharge une fois, on
 * les garde un mois, et le scraping suivant devient instantane et hors ligne.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const CACHE_DIR = path.join(config.dataPath, 'cache');
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

fs.mkdirSync(CACHE_DIR, { recursive: true });

function slug(key) {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

export function read(key) {
  const file = path.join(CACHE_DIR, `${slug(key)}.json`);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > TTL_MS) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function write(key, value) {
  const file = path.join(CACHE_DIR, `${slug(key)}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(value));
  } catch (err) {
    console.warn(`[cache] ecriture impossible (${err.message})`);
  }
  return value;
}

/** Recupere une valeur en cache, sinon la calcule et la stocke. */
export async function remember(key, producer) {
  const hit = read(key);
  if (hit !== null) return hit;
  const value = await producer();
  if (value !== null && value !== undefined) write(key, value);
  return value;
}

export function clear() {
  let removed = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.endsWith('.json')) { fs.unlinkSync(path.join(CACHE_DIR, f)); removed++; }
  }
  return removed;
}

export function stats() {
  let files = 0;
  let bytes = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (!f.endsWith('.json')) continue;
    files++;
    try { bytes += fs.statSync(path.join(CACHE_DIR, f)).size; } catch { /* ignore */ }
  }
  return { files, bytes };
}
