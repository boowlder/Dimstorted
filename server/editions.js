/**
 * Editions regionales et doublons.
 *
 * Un meme jeu peut exister en plusieurs versions : France, Europe, USA, Japon.
 * Ce sont des *editions*, a ne jamais confondre avec les *disques* d'un jeu
 * multi-CD. Dimstorted regroupe donc les fichiers d'un jeu a deux niveaux :
 *
 *   Metal Gear Solid
 *     ├─ edition France  ─ disque 1, disque 2   <- jouee par defaut
 *     └─ edition USA     ─ disque 1, disque 2
 *
 * L'edition jouee est choisie selon l'ordre de preference defini dans
 * config.json, ou fixee a la main sur la fiche du jeu.
 */

import { config } from './config.js';

/** Ordre par defaut pour un utilisateur francais. */
export const DEFAULT_PREFERENCE = ['France', 'Europe', 'Monde', 'USA', 'Japon'];

export function preference() {
  const p = config.regionPreference;
  return Array.isArray(p) && p.length ? p : DEFAULT_PREFERENCE;
}

/** Les fichiers sans region identifiee forment une edition "Inconnue". */
const UNKNOWN = 'Inconnue';

export function regionLabel(region) {
  return region || UNKNOWN;
}

/**
 * Regroupe les fichiers d'un jeu en editions regionales.
 * @returns {Array<{region, files, discs, size, preferred, rank}>}
 */
export function buildEditions(game) {
  const order = preference();
  const byRegion = new Map();

  for (const f of game.files || []) {
    const key = regionLabel(f.region);
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push(f);
  }

  const editions = [...byRegion.entries()].map(([region, files]) => {
    const sorted = [...files].sort((a, b) => (a.disc ?? 0) - (b.disc ?? 0));
    const idx = order.indexOf(region);
    return {
      region,
      files: sorted,
      discs: sorted.length,
      size: sorted.reduce((s, f) => s + (f.size || 0), 0),
      // Une region absente de la liste passe apres toutes celles qui y sont
      rank: idx === -1 ? order.length + (region === UNKNOWN ? 1 : 0) : idx,
      preferred: false,
    };
  });

  editions.sort((a, b) => a.rank - b.rank || a.region.localeCompare(b.region));

  // Le choix manuel prime sur l'ordre de preference
  const manual = game.preferred_region
    && editions.find((e) => e.region === game.preferred_region);
  const chosen = manual || editions[0];
  if (chosen) chosen.preferred = true;

  return editions;
}

/** L'edition a jouer : choix manuel, sinon la mieux classee. */
export function preferredEdition(game) {
  const editions = buildEditions(game);
  return editions.find((e) => e.preferred) || editions[0] || null;
}

/**
 * Un jeu est en doublon des qu'il porte plus d'une edition regionale.
 * Ce n'est pas une erreur en soi — c'est a l'utilisateur d'arbitrer.
 */
export function hasDuplicates(game) {
  return buildEditions(game).length > 1;
}
