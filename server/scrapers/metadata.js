/**
 * Source de metadonnees : les bases DAT du depot libretro-database.
 *
 * Format clrmamepro :
 *   game (
 *     name "007 - The World Is Not Enough (USA)"
 *     description "Good afternoon, James..."
 *     developer "Black Ops Entertainment"
 *     publisher "Electronic Arts"
 *     releaseyear "2000"
 *   )
 *
 * Le dossier "developer" porte l'enregistrement le plus riche (synopsis
 * compris). Les dossiers genre/maxusers/releaseyear le completent quand ils
 * existent. Les synopsis sont en anglais : libretro n'en publie pas en
 * francais. Une traduction viendrait de ScreenScraper, qui exige un compte.
 */

import { remember } from './cache.js';
import { systemsFor } from './systems.js';
import { bestMatch, normalize } from './match.js';

const BASE = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat';
const FOLDERS = ['developer', 'genre', 'maxusers', 'releaseyear', 'publisher'];

/**
 * Decoupe un DAT clrmamepro en enregistrements de jeu.
 *
 * Deux conventions coexistent dans le depot libretro :
 *   - disques (PS1, PS2, Dreamcast) : le titre est dans `name`, et
 *     l'enregistrement porte deja synopsis, editeur et annee
 *   - cartouches (NES, Mega Drive, ...) : le titre est dans `comment`, et
 *     chaque champ vit dans un DAT separe, l'entree etant identifiee par CRC
 */
function parseDat(text) {
  const games = [];
  const re = /game\s*\(([\s\S]*?)\n\)/g;
  for (const block of text.matchAll(re)) {
    const body = block[1];
    const entry = {};
    for (const field of body.matchAll(/^\s*([a-z_]+)\s+"((?:[^"\\]|\\.)*)"/gim)) {
      entry[field[1].toLowerCase()] = field[2].replace(/\\(.)/g, '$1');
    }
    // Certains champs numeriques ne sont pas entre guillemets (ex. `users 1`)
    for (const field of body.matchAll(/^\s*([a-z_]+)\s+(\d+)\s*$/gim)) {
      const key = field[1].toLowerCase();
      if (entry[key] === undefined) entry[key] = field[2];
    }
    // Le CRC sert de cle de rapprochement fiable pour une evolution future
    const crc = body.match(/\brom\s*\(\s*crc\s+([0-9A-Fa-f]{8})/);
    if (crc) entry.crc = crc[1].toUpperCase();

    const title = entry.name || entry.comment;
    if (!title) continue;
    entry.name = title;
    games.push(entry);
  }
  return games;
}

/** Telecharge et met en cache un DAT. Renvoie [] s'il n'existe pas. */
async function loadDat(folder, system) {
  return remember(`dat_${folder}_${system}`, async () => {
    const url = `${BASE}/${folder}/${encodeURIComponent(system)}.dat`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Dimstorted' } });
    if (!res.ok) return [];
    return parseDat(await res.text());
  });
}

/**
 * Construit, pour une console, un dictionnaire nom normalise -> metadonnees,
 * en fusionnant tous les dossiers disponibles.
 */
async function buildIndex(consoleId) {
  const { meta } = systemsFor(consoleId);
  if (!meta.length) return { byName: new Map(), names: [] };

  // Chaque DAT ne porte qu'un champ pour les cartouches (developer dans l'un,
  // genre dans l'autre...). Ils partagent en revanche le CRC de la ROM, qui
  // est donc la cle de jointure fiable — le nom, lui, varie d'un DAT a l'autre.
  const merged = new Map();
  for (const system of meta) {
    for (const folder of FOLDERS) {
      const entries = await loadDat(folder, system);
      for (const e of entries) {
        const key = e.crc ? `crc:${e.crc}` : `name:${e.name}`;
        const current = merged.get(key) || {};
        for (const [k, v] of Object.entries(e)) {
          if (v && current[k] === undefined) current[k] = v;
        }
        merged.set(key, current);
      }
    }
  }

  const byName = new Map();
  for (const entry of merged.values()) {
    if (entry.name) byName.set(entry.name, entry);
  }
  return { byName, names: [...byName.keys()] };
}

const indexCache = new Map();
async function getIndex(consoleId) {
  if (!indexCache.has(consoleId)) indexCache.set(consoleId, await buildIndex(consoleId));
  return indexCache.get(consoleId);
}

function toYear(value) {
  const n = parseInt(String(value ?? '').slice(0, 4), 10);
  return Number.isFinite(n) && n > 1970 && n < 2040 ? n : null;
}

function toPlayers(value) {
  const n = parseInt(String(value ?? '').replace(/\D+/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n <= 16 ? n : null;
}

/**
 * Cherche les metadonnees d'un jeu.
 * @returns {{matched: string|null, score: number, confident: boolean,
 *            description, year, publisher, developer, genre, players, serial}}
 */
export async function fetchMetadata(game, { force = null } = {}) {
  const empty = {
    matched: null, score: 0, confident: false,
    description: null, year: null, publisher: null,
    developer: null, genre: null, players: null, serial: null,
  };

  const { byName, names } = await getIndex(game.console);
  if (!names.length) return empty;

  let entry;
  let score = 0;
  let confident = false;

  if (force) {
    entry = byName.get(force) || [...byName.values()].find((e) => normalize(e.name) === normalize(force));
    if (entry) { score = 1; confident = true; }
  } else {
    const match = bestMatch(game.title, names, { region: game.region });
    if (match) {
      entry = byName.get(match.raw);
      score = match.score;
      confident = match.confident;
    }
  }
  if (!entry) return empty;

  return {
    matched: entry.name,
    score,
    confident,
    description: entry.description || null,
    year: toYear(entry.releaseyear),
    publisher: entry.publisher || null,
    developer: entry.developer || null,
    genre: entry.genre || null,
    players: toPlayers(entry.users || entry.maxusers),
    serial: entry.serial || null,
  };
}

/** Vide l'index memoire (apres un nettoyage du cache disque). */
export function resetIndex() {
  indexCache.clear();
}
