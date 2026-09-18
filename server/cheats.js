/**
 * Codes de triche, depuis la base publique libretro.
 *
 * Les fichiers `.cht` suivent la convention de nommage No-Intro — la meme que
 * les jaquettes et les bases de metadonnees. On dispose donc deja du nom
 * exact grace a l'identification par CRC ou au rapprochement de jaquette.
 *
 * On ne construit aucune interface : EmulatorJS a la sienne. Il suffit de lui
 * transmettre la liste avant le chargement, via `EJS_cheats`.
 */

import { remember } from './scrapers/cache.js';
import { systemsFor } from './scrapers/systems.js';
import { bestMatch } from './scrapers/match.js';

const BASE = 'https://raw.githubusercontent.com/libretro/libretro-database/master/cht';

/** Un fichier trop fourni sature le menu sans rien apporter. */
const MAX = 400;

/**
 * Analyse le format clef/valeur des fichiers `.cht` :
 *   cheat0_desc = "Always Big"
 *   cheat0_code = "0754:00+0756:01"
 */
function parseCht(text) {
  const byIndex = new Map();
  for (const m of text.matchAll(/^\s*cheat(\d+)_(desc|code)\s*=\s*"([^"]*)"/gim)) {
    const i = Number(m[1]);
    const entry = byIndex.get(i) || {};
    entry[m[2]] = m[3];
    byIndex.set(i, entry);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, e]) => e)
    .filter((e) => e.desc && e.code)
    .slice(0, MAX);
}

async function fetchFor(system, name) {
  const url = `${BASE}/${encodeURIComponent(system)}/${encodeURIComponent(`${name}.cht`)}`;
  return remember(`cht_${system}_${name}`, async () => {
    const res = await fetch(url, { headers: { 'User-Agent': 'Dimstorted' } });
    if (!res.ok) return [];
    return parseCht(await res.text());
  });
}

/**
 * Cherche les codes d'un jeu.
 *
 * On tente d'abord le nom exact retenu lors du scraping — c'est le plus sur.
 * A defaut, un rapprochement flou sur l'index des jaquettes, qui partage la
 * meme convention de nommage.
 */
export async function forGame(game) {
  const { meta, thumbs } = systemsFor(game.console);
  const systems = meta.length ? meta : thumbs;
  if (!systems.length) return { cheats: [], matched: null };

  const candidates = [];

  /*
   * Le nom retenu pour la jaquette porte parfois un tag que le fichier de
   * codes n'a pas — « (Mega Drive Mini) », « (Alternate) ». On essaie donc
   * le nom complet, puis progressivement sans ses tags de fin.
   */
  if (game.scrape_match) {
    let n = game.scrape_match;
    candidates.push(n);
    while (/\s*\([^)]*\)\s*$/.test(n)) {
      n = n.replace(/\s*\([^)]*\)\s*$/, '');
      if (n) candidates.push(n);
    }
  }

  /*
   * Les bases ecrivent « Story of Thor, The » la ou Dimstorted affiche
   * « The Story of Thor ». On propose donc aussi la forme inversee.
   */
  const inverted = game.title.replace(
    /^(The|A|An|Le|La|Les|Der|Die|Das|El|Los)\s+(.+?)(\s*[-–:].*)?$/i,
    (_, art, rest, tail) => `${rest}, ${art}${tail || ''}`,
  );
  const bases = inverted !== game.title ? [game.title, inverted] : [game.title];

  for (const base of bases) {
    if (game.region) candidates.push(`${base} (${game.region})`);
    candidates.push(`${base} (USA, Europe)`, `${base} (Europe)`,
      `${base} (USA)`, `${base} (World)`, base);
  }

  for (const system of systems) {
    for (const name of candidates) {
      const list = await fetchFor(system, name);
      if (list.length) return { cheats: list, matched: name, system };
    }
  }
  return { cheats: [], matched: null };
}

/** Format attendu par EmulatorJS : [description, code]. */
export function toEmulatorJS(cheats) {
  return cheats.map((c) => [c.desc, c.code]);
}

export { parseCht };
