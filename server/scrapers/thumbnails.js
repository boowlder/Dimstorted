/**
 * Source d'images : le depot public libretro-thumbnails.
 *
 * Trois visuels par jeu :
 *   Named_Boxarts  la jaquette (portrait)
 *   Named_Snaps    une capture de gameplay (paysage)
 *   Named_Titles   l'ecran-titre (paysage)
 *
 * Les cartes de Dimstorted etant au format 16/9, la capture sert de visuel
 * principal et la jaquette d'accent sur la fiche detaillee.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { remember } from './cache.js';
import { systemsFor } from './systems.js';
import { bestMatch, search } from './match.js';

const BASE = 'https://thumbnails.libretro.com';
const COVERS_DIR = path.join(config.dataPath, 'covers');

export const KINDS = {
  box: 'Named_Boxarts',
  snap: 'Named_Snaps',
  title: 'Named_Titles',
};

/** Recupere et met en cache la liste des jaquettes d'un systeme. */
async function listSystem(system) {
  return remember(`thumbs_${system}`, async () => {
    const url = `${BASE}/${encodeURIComponent(system)}/${KINDS.box}/`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Dimstorted' } });
    if (!res.ok) {
      console.warn(`[jaquettes] ${system} : HTTP ${res.status}`);
      return [];
    }
    const html = await res.text();
    // L'index Apache liste chaque fichier dans un href
    const names = [...html.matchAll(/href="([^"]+\.png)"/gi)]
      .map((m) => decodeURIComponent(m[1]))
      .filter((n) => !n.includes('/'));
    return [...new Set(names)];
  });
}

/** Liste tous les candidats d'une console Dimstorted, tous systemes confondus. */
export async function candidatesFor(consoleId) {
  const { thumbs } = systemsFor(consoleId);
  const out = [];
  for (const system of thumbs) {
    for (const name of await listSystem(system)) out.push({ system, name });
  }
  return out;
}

/** Telecharge une image et l'ecrit sur le disque. Renvoie le chemin public. */
async function download(system, kind, name, destBase) {
  const url = `${BASE}/${encodeURIComponent(system)}/${KINDS[kind]}/${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Dimstorted' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512) return null; // image vide ou page d'erreur
  const file = `${destBase}-${kind}.png`;
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(COVERS_DIR, file), buf);
  return `/covers/${file}`;
}

/**
 * Cherche et telecharge les visuels d'un jeu.
 *
 * @returns {{matched: string|null, score: number, confident: boolean,
 *            box: string|null, snap: string|null, title: string|null}}
 */
export async function fetchArt(game, { force = null } = {}) {
  const all = await candidatesFor(game.console);
  if (!all.length) {
    return { matched: null, score: 0, confident: false, box: null, snap: null, title: null };
  }

  let chosen;
  if (force) {
    chosen = all.find((c) => c.name === force) || null;
    if (!chosen) return { matched: null, score: 0, confident: false, box: null, snap: null, title: null };
    chosen = { ...chosen, score: 1, confident: true };
  } else {
    const match = bestMatch(game.title, all.map((c) => c.name), { region: game.region });
    if (!match) {
      return { matched: null, score: 0, confident: false, box: null, snap: null, title: null };
    }
    const entry = all.find((c) => c.name === match.raw);
    chosen = { ...entry, score: match.score, confident: match.confident };
  }

  const destBase = `game-${game.id}`;
  const [box, snap, title] = await Promise.all([
    download(chosen.system, 'box', chosen.name, destBase).catch(() => null),
    download(chosen.system, 'snap', chosen.name, destBase).catch(() => null),
    download(chosen.system, 'title', chosen.name, destBase).catch(() => null),
  ]);

  return {
    matched: chosen.name.replace(/\.png$/i, ''),
    score: chosen.score,
    confident: chosen.confident,
    box, snap, title,
  };
}

/** Propositions pour l'ecran de correction manuelle. */
export async function suggest(consoleId, query, limit = 12) {
  const all = await candidatesFor(consoleId);
  return search(query, all.map((c) => c.name), limit).map((r) => {
    const entry = all.find((c) => c.name === r.raw);
    return {
      name: r.name,
      score: r.score,
      preview: `${BASE}/${encodeURIComponent(entry.system)}/${KINDS.box}/${encodeURIComponent(r.raw)}`,
    };
  });
}

/** Supprime les images d'un jeu (suppression de fiche, ou nouveau scraping). */
export function removeArt(gameId) {
  for (const kind of Object.keys(KINDS)) {
    const file = path.join(COVERS_DIR, `game-${gameId}-${kind}.png`);
    try { fs.unlinkSync(file); } catch { /* absent */ }
  }
}
