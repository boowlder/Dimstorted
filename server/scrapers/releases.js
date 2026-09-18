/**
 * Sorties officielles connues d'un jeu, d'apres les bases No-Intro et Redump
 * publiees par libretro.
 *
 * Sert a repondre a une question concrete : « ce jeu est-il jamais sorti en
 * France ? ». Un titre dont toutes les sorties recensees sont japonaises est
 * signale comme exclusivite — ce qui justifie de garder la version japonaise
 * dans une bibliotheque autrement francophone.
 *
 * Prudence : la reponse porte sur *ce titre*. Beaucoup de jeux japonais sont
 * sortis en Occident sous un autre nom (Musha Aleste / M.U.S.H.A.). On parle
 * donc d'« aucune sortie connue sous ce titre », jamais d'une verite absolue.
 */

import { remember } from './cache.js';
import { systemsFor } from './systems.js';
import { bestMatch, parseCandidate, normalize } from './match.js';

const BASE = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat';

/** Regions No-Intro considerees comme une sortie accessible en France. */
const WESTERN = new Set(['Europe', 'France', 'World', 'Germany', 'Spain', 'Italy', 'Netherlands']);
const FRENCH = new Set(['France', 'Europe', 'World']);

/** Traduction des libelles No-Intro. */
const FR_LABEL = {
  Japan: 'Japon', USA: 'USA', Europe: 'Europe', France: 'France',
  World: 'Monde', Brazil: 'Brésil', Korea: 'Corée', Australia: 'Australie',
  Germany: 'Allemagne', Spain: 'Espagne', Italy: 'Italie', Taiwan: 'Taïwan',
  China: 'Chine', Netherlands: 'Pays-Bas', Sweden: 'Suède', Canada: 'Canada',
};

function frLabel(r) {
  return FR_LABEL[r] || r;
}

/** Charge la liste des sorties d'un systeme (No-Intro pour les cartouches,
 *  Redump pour les disques). */
async function loadReleases(system) {
  return remember(`releases_${system}`, async () => {
    for (const folder of ['no-intro', 'redump']) {
      const url = `${BASE}/${folder}/${encodeURIComponent(system)}.dat`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Dimstorted' } });
      if (!res.ok) continue;
      const text = await res.text();
      const out = [];
      for (const block of text.matchAll(/game\s*\(([\s\S]*?)\n\)/g)) {
        const body = block[1];
        const name = body.match(/^\s*name\s+"([^"]*)"/im)?.[1];
        if (!name) continue;
        const region = body.match(/^\s*region\s+"([^"]*)"/im)?.[1] || null;
        out.push({ name, region });
      }
      if (out.length) return out;
    }
    return [];
  });
}

/** Regions extraites des parentheses, quand le champ `region` est absent. */
function regionsFromTags(name) {
  const { tags } = parseCandidate(name);
  const found = [];
  for (const t of tags) {
    for (const part of t.split(',')) {
      const v = part.trim();
      if (FR_LABEL[v] || WESTERN.has(v) || v === 'Japan') found.push(v);
    }
  }
  return found;
}

/**
 * Determine le statut de sortie d'un jeu.
 *
 * @returns {{known: boolean, regions: string[], releasedInFrance: boolean,
 *            exclusivity: string|null, matched: string|null}}
 */
export async function releaseInfo(game) {
  const { meta, thumbs } = systemsFor(game.console);
  const systems = meta.length ? meta : thumbs;
  const empty = {
    known: false, regions: [], releasedInFrance: false,
    exclusivity: null, matched: null,
  };
  if (!systems.length) return empty;

  const all = [];
  for (const s of systems) all.push(...await loadReleases(s));
  if (!all.length) return empty;

  // On retient toutes les entrees dont le titre de base est identique :
  // ce sont les differentes sorties regionales du meme jeu.
  const target = normalize(parseCandidate(game.title).base || game.title);
  let siblings = all.filter((r) => normalize(parseCandidate(r.name).base) === target);

  // Titre absent tel quel : on tente un rapprochement flou pour retrouver
  // l'orthographe exacte, puis on regroupe sur elle
  if (!siblings.length) {
    const m = bestMatch(game.title, all.map((r) => r.name), { region: game.region });
    if (!m || !m.confident) return empty;
    const base = normalize(parseCandidate(m.raw).base);
    siblings = all.filter((r) => normalize(parseCandidate(r.name).base) === base);
  }
  if (!siblings.length) return empty;

  const regions = new Set();
  for (const s of siblings) {
    if (s.region) {
      for (const part of s.region.split(',')) regions.add(part.trim());
    } else {
      for (const r of regionsFromTags(s.name)) regions.add(r);
    }
  }
  const list = [...regions].filter(Boolean);
  if (!list.length) return empty;

  const releasedInFrance = list.some((r) => FRENCH.has(r));
  const western = list.some((r) => WESTERN.has(r));

  // Exclusivite : aucune sortie occidentale recensee sous ce titre
  let exclusivity = null;
  if (!western) {
    const primary = list.includes('Japan') ? 'Japan' : list[0];
    exclusivity = frLabel(primary);
  }

  return {
    known: true,
    regions: list.map(frLabel).sort(),
    releasedInFrance,
    exclusivity,
    matched: siblings[0].name,
  };
}
