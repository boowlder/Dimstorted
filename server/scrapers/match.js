/**
 * Rapprochement flou entre un titre de la bibliotheque et les noms de fichiers
 * des bases libretro (convention No-Intro / Redump).
 *
 * Le probleme : Dimstorted stocke "Metal Gear Solid", les bases stockent
 * "Metal Gear Solid (Europe) (Disc 1)". Il faut retrouver le bon candidat
 * sans jamais imposer une correspondance douteuse — un mauvais rapprochement
 * colle la mauvaise jaquette sur un jeu, ce qui est pire que pas de jaquette.
 */

/** Regions classees par preference pour un utilisateur francais. */
const REGION_RANK = [
  ['france', 'fr'],
  ['europe', 'eur', 'pal'],
  ['world', 'monde'],
  ['usa', 'us', 'ntsc'],
  ['japan', 'jpn', 'jp'],
];

const NOISE_TAGS = /^(rev|v\d|beta|proto|demo|sample|alpha|unl|hack|aftermarket|virtual console|gamecube|promo|budget|greatest hits|platinum|players choice|classics)/i;

/** Retire accents, ponctuation et articles pour comparer des titres. */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|le|la|les|el|der|die|das)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decoupe "Nom (Europe) (Disc 1)" en base + liste de tags. */
export function parseCandidate(filename) {
  const name = filename.replace(/\.(png|jpe?g)$/i, '');
  const tags = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const base = name.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
  return { name, base, tags };
}

/** Coefficient de Dice sur les bigrammes de caracteres : 0 a 1. */
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const count = bigrams.get(g) || 0;
    if (count > 0) { bigrams.set(g, count - 1); hits++; }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

/** Rang de region d'un candidat : plus petit = plus souhaitable. */
function regionScore(tags, preferred) {
  const lowered = tags.map((t) => t.toLowerCase());
  if (preferred) {
    const p = preferred.toLowerCase();
    if (lowered.some((t) => t.split(/[,+/]/).some((x) => x.trim() === p))) return -1;
  }
  for (let i = 0; i < REGION_RANK.length; i++) {
    if (lowered.some((t) => REGION_RANK[i].some((r) => t.split(/[,+/]/).some((x) => x.trim() === r)))) {
      return i;
    }
  }
  return REGION_RANK.length;
}

/** Un candidat portant des tags de revision ou de prototype est moins bon. */
function noisePenalty(tags) {
  let penalty = 0;
  for (const t of tags) {
    if (NOISE_TAGS.test(t)) penalty += 0.02;
    if (/beta|proto|demo|sample|alpha/i.test(t)) penalty += 0.08;
  }
  return Math.min(penalty, 0.25);
}

/**
 * Cherche le meilleur candidat pour un titre.
 *
 * @param {string} title      titre tel que stocke dans Dimstorted
 * @param {string[]} candidates noms de fichiers des bases libretro
 * @param {{region?: string, disc?: number}} opts
 * @returns {{name: string, score: number, confident: boolean}|null}
 */
export function bestMatch(title, candidates, opts = {}) {
  const target = normalize(title);
  if (!target) return null;

  let best = null;
  for (const raw of candidates) {
    const c = parseCandidate(raw);
    const base = normalize(c.base);
    if (!base) continue;

    let score = dice(target, base);
    if (score < 0.55) continue; // ecart trop grand, inutile d'affiner

    // Une egalite exacte doit dominer toute similarite approchante
    if (base === target) score = 1;

    // Preference de region : un ecart de rang coute peu, mais departage
    score -= regionScore(c.tags, opts.region) * 0.012;
    score -= noisePenalty(c.tags);

    // Si on cherche un disque precis, privilegier le bon
    if (opts.disc) {
      const discTag = c.tags.find((t) => /^(disc|disk|cd)\s*\d+/i.test(t));
      if (discTag) {
        const n = parseInt(discTag.replace(/\D+/g, ''), 10);
        score += n === opts.disc ? 0.03 : -0.05;
      }
    }

    if (!best || score > best.score) best = { name: c.name, score, raw };
  }

  if (!best) return null;
  // Les bonus de region peuvent pousser le score au-dela de 1 : on le ramene
  // dans [0,1] pour qu'il reste lisible tel quel dans l'interface.
  const score = Math.min(1, Math.max(0, best.score));
  return {
    name: best.name,
    raw: best.raw,
    score: Math.round(score * 1000) / 1000,
    // Seuil haut volontaire : mieux vaut pas de jaquette qu'une mauvaise
    confident: score >= 0.92,
  };
}

/** Recherche libre, pour l'ecran de correction manuelle. */
export function search(query, candidates, limit = 12) {
  const target = normalize(query);
  if (!target) return [];
  const scored = [];
  for (const raw of candidates) {
    const c = parseCandidate(raw);
    const s = dice(target, normalize(c.base));
    if (s > 0.35) scored.push({ name: c.name, raw, score: Math.round(s * 1000) / 1000 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
