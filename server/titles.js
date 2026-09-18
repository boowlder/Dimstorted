/**
 * Nettoyage des noms de fichiers en titres lisibles.
 *
 * Les dumps traînent toujours des annotations : region, revision, tags de
 * verification, numero de disque, groupe de scene. On extrait ce qui est
 * utile (region, numero de disque) et on jette le reste.
 */

import path from 'node:path';

/*
 * Redump et No-Intro ecrivent "(Europe)" en toutes lettres, mais les packs
 * qui circulent abregent souvent en "(EU)", "(US)", "(JP)". Sans ces codes,
 * la region reste inconnue — et c'est elle qui decide quelle edition on garde
 * et laquelle est un doublon.
 */
const REGIONS = {
  usa: 'USA', u: 'USA', us: 'USA', ntsc: 'USA', 'ntsc-u': 'USA',
  europe: 'Europe', e: 'Europe', eu: 'Europe', eur: 'Europe', pal: 'Europe',
  france: 'France', f: 'France', fr: 'France', fra: 'France',
  japan: 'Japon', j: 'Japon', jp: 'Japon', jpn: 'Japon', 'ntsc-j': 'Japon',
  germany: 'Allemagne', g: 'Allemagne', de: 'Allemagne', ger: 'Allemagne',
  spain: 'Espagne', s: 'Espagne', es: 'Espagne', spa: 'Espagne',
  italy: 'Italie', i: 'Italie', it: 'Italie', ita: 'Italie',
  world: 'Monde', w: 'Monde',
  'united kingdom': 'Royaume-Uni', uk: 'Royaume-Uni',
  netherlands: 'Pays-Bas', holland: 'Pays-Bas', nl: 'Pays-Bas',
  sweden: 'Suede', scandinavia: 'Scandinavie',
  australia: 'Australie', au: 'Australie',
  brazil: 'Bresil', br: 'Bresil',
  korea: 'Coree', kr: 'Coree',
  china: 'Chine', taiwan: 'Taiwan', asia: 'Asie', russia: 'Russie',
  canada: 'Canada',
};

// Annotations a supprimer purement et simplement
const NOISE = [
  /\[[^\]]*\]/g,                              // [!], [a1], [b], [T+Fre]
  /\((?:rev\s*[a-z0-9.]+)\)/gi,               // (Rev A), (Rev 1)
  /\((?:v\s*\d+(?:\.\d+)*)\)/gi,              // (v1.1)
  /\((?:beta|proto|prototype|demo|sample|alpha)\d*\)/gi,
  /\((?:unl|unlicensed|pirate|hack|aftermarket)\)/gi,
  /\((?:cart|cartridge|disc|disk)\s*version\)/gi,
  /\((?:en|fr|de|es|it|nl|pt|sv|da|no|fi|ja|ko|zh)(?:[,+](?:en|fr|de|es|it|nl|pt|sv|da|no|fi|ja|ko|zh))+\)/gi,
  /\b(?:iso|rom|redump|no-intro|goodset)\b/gi,
];

// Numero de disque : (Disc 1), (CD2), Disk 3, -CD1-
const DISC_PATTERNS = [
  /\((?:disc|disk|cd)\s*([0-9]+)[^)]*\)/i,
  /\b(?:disc|disk|cd)\s*[-_]?\s*([0-9]+)\b/i,
];

/**
 * Transforme un chemin de fichier en metadonnees de base.
 * @returns {{title: string, region: string|null, disc: number|null}}
 */
/**
 * Noms de fichiers qui ne disent rien du jeu. Un fangame HTML5 s'appelle
 * toujours `index.html` : c'est le dossier qui porte le titre.
 */
const GENERIC = new Set([
  'index', 'game', 'main', 'start', 'play', 'run', 'launcher',
  'default', 'home', 'jeu', 'demo',
]);

export function parseFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  let name = base;

  if (GENERIC.has(base.toLowerCase())) {
    const parent = path.basename(path.dirname(filePath));
    if (parent && !GENERIC.has(parent.toLowerCase())) name = parent;
  }
  return parseTitle(name, base);
}

/**
 * Analyse un titre deja depourvu d'extension.
 *
 * Indispensable pour les noms issus des bases No-Intro : passer
 * « Super Mario Bros. 3 (Europe) » a `parseFilename` ferait prendre
 * « . 3 (Europe) » pour une extension, et le titre perdrait son numero.
 */
export function parseTitle(rawName, fallback = null) {
  let name = rawName;
  const base = fallback ?? rawName;

  /*
   * Les sets TOSEC (Dreamcast) ecrivent la version HORS parentheses :
   * « Shenmue II v1.001 (2001)(Sega) ». Il faut la retirer AVANT la regle
   * qui change les points en espaces, sinon « v1.001 » devient « v1 001 »
   * et reste colle au titre — la fiche s'appelait « Shenmue II v1 001 ».
   */
  name = name.replace(/\s+v\d+(?:\.\d+)+[a-z]?\b/gi, '');

  // Les separateurs techniques deviennent des espaces
  name = name.replace(/[_]+/g, ' ');
  // Un point entre deux lettres est presque toujours un separateur de scene
  name = name.replace(/(?<=[a-z0-9])\.(?=[a-z0-9])/gi, ' ');

  const disc = extractDisc(name);
  const region = extractRegion(name);

  // Region et disque ont ete extraits : tout ce qui reste entre parentheses
  // est de la metadonnee de dump, jamais le titre. La convention No-Intro
  // reserve les parentheses aux annotations, on peut donc toutes les retirer.
  // C'est ce qui permet a "Jeu (France) (Disc 1)" et "Jeu (France) (Disc 1) (1)"
  // de se reconnaitre comme un seul et meme jeu.
  for (const p of DISC_PATTERNS) name = name.replace(p, ' ');
  for (const re of NOISE) name = name.replace(re, ' ');
  name = name.replace(/\([^)]*\)/g, ' ');

  name = name
    .replace(/\s*[-–]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  name = restoreLeadingArticle(name);
  name = titleCase(name);

  return { title: name || base, region, disc };
}

function extractDisc(name) {
  for (const p of DISC_PATTERNS) {
    const m = name.match(p);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n < 20) return n;
    }
  }
  return null;
}

/**
 * Ordre de resolution quand un dump couvre plusieurs regions.
 * "(Japan, Europe, Korea)" designe un jeu bel et bien sorti en Europe :
 * le classer en "Japon" le ferait passer a tort pour une exclusivite.
 */
const REGION_PRIORITY = ['France', 'Europe', 'Monde', 'USA', 'Japon'];

/**
 * Codes de langue. Ils partagent leur orthographe avec des codes de pays :
 * "fr" vaut France en region, francais en langue. Un groupe entier de codes
 * de langue — "(En,Fr,De,Es,It)" — decrit donc les langues du disque, pas sa
 * region, et le lire comme "France" ferait passer une edition europeenne pour
 * l'edition francaise. Un vrai doublon francais serait alors refuse a l'import.
 */
const LANGS = new Set([
  'en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'sv', 'da', 'no', 'fi',
  'ja', 'ko', 'zh', 'ru', 'pl', 'cs', 'hu', 'el', 'tr', 'ca',
]);

/** Deux codes de langue ou plus, et rien d'autre : c'est une liste de langues. */
function isLanguageList(parts) {
  return parts.length >= 2 && parts.every((x) => LANGS.has(x));
}

function extractRegion(name) {
  const groups = name.match(/\(([^)]+)\)/g) || [];
  const found = [];
  for (const g of groups) {
    const inner = g.slice(1, -1).toLowerCase().trim();
    const parts = inner.split(/[,+/]/).map((x) => x.trim()).filter(Boolean);
    if (isLanguageList(parts)) continue;
    for (const part of parts) {
      const r = REGIONS[part];
      if (r) found.push(r);
    }
  }
  if (!found.length) return null;
  for (const preferred of REGION_PRIORITY) {
    if (found.includes(preferred)) return preferred;
  }
  return found[0];
}

/**
 * "Legend of Zelda, The" -> "The Legend of Zelda"
 * "Legend of Zelda, The - Ocarina of Time" -> "The Legend of Zelda - Ocarina of Time"
 */
function restoreLeadingArticle(name) {
  const m = name.match(/^(.+?),\s*(The|A|An|Le|La|Les|Der|Die|Das|El|Los)(\s*[-–:].*)?$/i);
  return m ? `${m[2]} ${m[1]}${m[3] || ''}` : name;
}

const MINOR = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to', 'a', 'an', 'de', 'du', 'la', 'le', 'et']);

function titleCase(name) {
  // On ne touche pas aux titres deja en casse mixte (souvent corrects)
  if (/[a-z]/.test(name) && /[A-Z]/.test(name)) return name;
  return name
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (i > 0 && MINOR.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Cle de regroupement : deux disques d'un meme jeu doivent la partager.
 * Sert a fusionner "FF VII (Disc 1)" et "FF VII (Disc 2)" en une seule fiche.
 */
export function groupKey(title, consoleId) {
  const normalized = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return `${consoleId}:${normalized}`;
}
