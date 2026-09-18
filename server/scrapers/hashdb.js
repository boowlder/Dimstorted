/**
 * Identification exacte d'une ROM par son CRC32.
 *
 * Le rapprochement par titre est une approximation : il dépend du nom du
 * fichier, et les ROMs trouvées au hasard s'appellent souvent
 * `Super.Mario.World.[U].[!].smc` — ou pire, `rom1.bin`.
 *
 * Les bases No-Intro publient la taille et le CRC32 de chaque ROM connue.
 * Comparer ces deux valeurs donne le titre officiel exact, la région et le
 * numéro de série, sans jamais dépendre du nom donné au fichier.
 *
 * Limité aux cartouches : le CRC d'un jeu sur disque porte sur les pistes
 * brutes, pas sur le fichier `.iso` ou `.chd` — la comparaison n'aurait
 * aucun sens. Et hacher 4 Go pour chaque import serait de toute façon
 * disproportionné.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import { remember } from './cache.js';
import { systemsFor } from './systems.js';

const BASE = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro';

/** Au-delà, le fichier est un support optique : le CRC ne sert à rien. */
const MAX_SIZE = 96 * 1024 * 1024;

/** Consoles à cartouche, les seules où la comparaison a un sens. */
const CARTRIDGE = new Set([
  'nes', 'snes', 'n64', 'gb', 'gba', 'segaMD', 'segaMS', 'segaGG', 'sg1000',
]);

export function supportsHashMatch(consoleId) {
  return CARTRIDGE.has(consoleId);
}

/**
 * Construit l'index `taille:crc -> jeu` d'un système.
 * Mis en cache comme les autres bases : un seul téléchargement par mois.
 */
async function loadIndex(system) {
  return remember(`crc_${system}`, async () => {
    const res = await fetch(`${BASE}/${encodeURIComponent(system)}.dat`, {
      headers: { 'User-Agent': 'Dimstorted' },
    });
    if (!res.ok) return {};
    const text = await res.text();

    const index = {};
    for (const block of text.matchAll(/game\s*\(([\s\S]*?)\n\)/g)) {
      const body = block[1];
      const name = body.match(/^\s*name\s+"([^"]*)"/im)?.[1];
      if (!name) continue;
      const region = body.match(/^\s*region\s+"([^"]*)"/im)?.[1] || null;
      const serial = body.match(/^\s*serial\s+"([^"]*)"/im)?.[1] || null;

      /*
       * On cherche directement les paires `size … crc …`, sans tenter de
       * délimiter la ligne `rom ( … )` : le nom du jeu contient lui-même des
       * parenthèses — « (Japan) (En) » — et toute tentative de borner le bloc
       * s'arrête dessus avant d'atteindre le CRC.
       *
       * Un même jeu liste souvent plusieurs fichiers : version avec en-tête
       * iNES et version sans. Les deux sont indexées.
       */
      for (const rom of body.matchAll(/\bsize\s+(\d+)\s+crc\s+([0-9A-Fa-f]{8})\b/g)) {
        index[`${rom[1]}:${rom[2].toUpperCase()}`] = { name, region, serial };
      }
    }
    return index;
  });
}

const memory = new Map();

async function indexFor(consoleId) {
  if (memory.has(consoleId)) return memory.get(consoleId);
  const { meta, thumbs } = systemsFor(consoleId);
  const systems = meta.length ? meta : thumbs;

  const merged = {};
  for (const s of systems) Object.assign(merged, await loadIndex(s));
  memory.set(consoleId, merged);
  return merged;
}

/** CRC32 d'un fichier, lu par blocs pour ne rien charger en mémoire. */
export function crc32(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024 * 1024);
    let crc = 0;
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      crc = zlib.crc32(buf.subarray(0, bytes), crc);
    }
    return crc.toString(16).toUpperCase().padStart(8, '0');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * Identifie une ROM par son contenu.
 *
 * @returns {{name, region, serial, crc}|null} l'entrée No-Intro exacte,
 *          ou null si la console, la taille ou le CRC ne permettent rien.
 */
export async function identify(filePath, consoleId) {
  if (!supportsHashMatch(consoleId)) return null;

  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return null;
  }
  if (!size || size > MAX_SIZE) return null;

  const crc = crc32(filePath);
  if (!crc) return null;

  const index = await indexFor(consoleId);
  const hit = index[`${size}:${crc}`];
  return hit ? { ...hit, crc } : null;
}

export function resetIndex() {
  memory.clear();
}
