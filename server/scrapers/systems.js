/**
 * Correspondance entre les consoles de Dimstorted et les noms de systemes
 * utilises par les depots libretro.
 *
 * `thumbs` et `meta` sont des listes : une console de Dimstorted peut couvrir
 * plusieurs systemes libretro (la Game Boy et la Game Boy Color sont une seule
 * entree chez nous, deux depots chez eux).
 *
 * Couverture verifiee le 16 septembre 2026 :
 *   - GameCube et Mega-CD ont des jaquettes mais aucune metadonnee
 *   - PS1, PS2 et Dreamcast n'ont que le DAT "developer", qui contient
 *     neanmoins le synopsis, l'editeur et l'annee
 */

export const SYSTEMS = {
  nes: {
    thumbs: ['Nintendo - Nintendo Entertainment System'],
    meta: ['Nintendo - Nintendo Entertainment System'],
  },
  snes: {
    thumbs: ['Nintendo - Super Nintendo Entertainment System'],
    meta: ['Nintendo - Super Nintendo Entertainment System'],
  },
  n64: {
    thumbs: ['Nintendo - Nintendo 64'],
    meta: ['Nintendo - Nintendo 64'],
  },
  gb: {
    thumbs: ['Nintendo - Game Boy Color', 'Nintendo - Game Boy'],
    meta: ['Nintendo - Game Boy Color', 'Nintendo - Game Boy'],
  },
  gba: {
    thumbs: ['Nintendo - Game Boy Advance'],
    meta: ['Nintendo - Game Boy Advance'],
  },
  gamecube: {
    thumbs: ['Nintendo - GameCube'],
    meta: [], // aucune metadonnee publiee
  },
  segaMD: {
    thumbs: ['Sega - Mega Drive - Genesis'],
    meta: ['Sega - Mega Drive - Genesis'],
  },
  segaMS: {
    thumbs: ['Sega - Master System - Mark III'],
    meta: ['Sega - Master System - Mark III'],
  },
  segaGG: {
    thumbs: ['Sega - Game Gear'],
    meta: ['Sega - Game Gear'],
  },
  sg1000: {
    thumbs: ['Sega - SG-1000'],
    meta: ['Sega - SG-1000'],
  },
  segaCD: {
    thumbs: ['Sega - Mega-CD - Sega CD'],
    meta: [],
  },
  dreamcast: {
    thumbs: ['Sega - Dreamcast'],
    meta: ['Sega - Dreamcast'],
  },
  psx: {
    thumbs: ['Sony - PlayStation'],
    meta: ['Sony - PlayStation'],
  },
  ps2: {
    thumbs: ['Sony - PlayStation 2'],
    meta: ['Sony - PlayStation 2'],
  },
  psp: {
    thumbs: ['Sony - PlayStation Portable'],
    meta: ['Sony - PlayStation Portable'],
  },
};

export function systemsFor(consoleId) {
  return SYSTEMS[consoleId] || { thumbs: [], meta: [] };
}
