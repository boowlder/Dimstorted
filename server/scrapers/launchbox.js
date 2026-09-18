/**
 * Source de métadonnées : LaunchBox Games Database.
 *
 * libretro ne publie de synopsis que pour les systèmes à disque — 1 entrée
 * sur 623 en Master System, 1 sur 1666 en Game Boy, contre 9801 sur 9947 en
 * PlayStation. LaunchBox comble ce trou : 91 % de ses jeux ont un synopsis,
 * et la couverture va de 89 à 100 % sur les plateformes d'ici.
 *
 * L'index est local (`data/launchbox.json`, préparé par
 * `scripts/fetch-launchbox.js`) : aucune requête réseau à la recherche, et
 * la bibliothèque entière se remplit en quelques secondes.
 *
 * Les textes sont en anglais ; LaunchBox n'en publie pas d'autres.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { PLATEFORMES } from './launchbox-plateformes.js';

const INDEX_PATH = path.join(config.dataPath, 'launchbox.json');

/*
 * Les images de LaunchBox sont servies par leur CDN public, sans compte ni
 * cle. Le chemin stocke dans l'index ressemble a
 * « Sonic the Hedgehog/Clear Logo/Sonic the Hedgehog-01.png » : chaque
 * segment doit etre encode separement, sinon les barres obliques
 * disparaissent avec le reste.
 */
const CDN = 'https://images.launchbox-app.com/';

export function urlImage(chemin) {
  return CDN + String(chemin).split('/').map(encodeURIComponent).join('/');
}

let index = null;   // plateforme -> Map(cle -> entrée)

/** Chiffres romains isolés : « Mega Man II » et « Mega Man 2 » sont le même jeu. */
const VERS_ARABE = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7',
  viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13',
};

function normaliser(s) {
  let t = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/&/g, ' and ');
  t = t.replace(/\b(the|a|an|le|la|les|el|los)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  // Le chiffre romain n'est converti que s'il forme un mot entier : « X4 »
  // de Mega Man X4 doit rester intact.
  return t.split(' ').map((m) => VERS_ARABE[m] || m).join(' ').trim();
}

/**
 * Numéro de suite d'un titre.
 *
 * « Wario Land II » et « Wario Land 3 » ne diffèrent que d'un caractère mais
 * ce sont deux jeux. Un rapprochement approché les confond volontiers — et un
 * mauvais synopsis est pire qu'un synopsis absent.
 */
function numero(cle) {
  const dernier = cle.split(' ').pop();
  return /^\d+$/.test(dernier) ? Number(dernier) : null;
}

function memeSuite(a, b) {
  return numero(a) === numero(b);
}

/**
 * Titres que LaunchBox publie sous un autre nom.
 *
 * Trois cas : les jeux japonais catalogués sous leur nom occidental, les
 * titres français, et « Beyond Oasis » qui n'a rien à voir avec « The Story
 * of Thor » alors que c'est le même jeu. Aucune règle ne rattrape ça.
 */
const ALIAS = {
  'akai koudan zillion': 'Zillion',
  'aleste': 'Power Strike',
  'super wonder boy': 'Wonder Boy',
  'kujaku ou': 'Spellcaster',
  'story of thor': 'Beyond Oasis',
  'bokujou monogatari gb': 'Harvest Moon GB',
  'rockman world 5': 'Mega Man V',
  'sa ga 3 jikuu no hasha': 'Final Fantasy Legend III',
  '007 demain ne meurt jamais': '007: Tomorrow Never Dies',
  'pokemon version rouge': 'Pokémon Red Version',
  'pokemon version bleue': 'Pokémon Blue Version',
  'pokemon version jaune edition speciale pikachu': 'Pokémon Yellow Version',
  'pokemon version or': 'Pokémon Gold Version',
  'pokemon version argent': 'Pokémon Silver Version',
  'pokemon version cristal': 'Pokémon Crystal Version',
};

/**
 * Préfixes d'éditeur que LaunchBox ajoute et pas les jeux de dumps :
 * « Aladdin » y est catalogué « Disney's Aladdin ».
 */
const PREFIXES = /^(walt disney's|disney's|disney|sega's|nintendo's)\s+/i;

/** « Legend of Zelda, The » ⇄ « The Legend of Zelda ». */
function variantes(titre) {
  const out = new Set([titre]);
  const alias = ALIAS[normaliser(titre)];
  if (alias) out.add(alias);
  const sansPrefixe = titre.replace(PREFIXES, '');
  if (sansPrefixe !== titre) out.add(sansPrefixe);
  const inverse = titre.replace(
    /^(.+?), (The|A|An|Le|La|Les|Der|Die|Das)\b(.*)$/i,
    (_, reste, article, fin) => `${article} ${reste}${fin}`,
  );
  if (inverse !== titre) out.add(inverse);
  // Les sous-titres après « - » ou « : » sont parfois absents chez LaunchBox
  const sansSuffixe = titre.replace(/\s*[-–:]\s*[^-–:]+$/, '');
  if (sansSuffixe !== titre && sansSuffixe.length > 3) out.add(sansSuffixe);
  return [...out];
}

function charger() {
  if (index) return index;
  if (!fs.existsSync(INDEX_PATH)) {
    index = new Map();
    return index;
  }
  const brut = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  index = new Map();
  for (const jeu of brut) {
    if (!index.has(jeu.Platform)) index.set(jeu.Platform, new Map());
    const m = index.get(jeu.Platform);
    const cle = normaliser(jeu.Name);
    // Première entrée gardée : le dump liste d'abord l'édition principale
    if (!m.has(cle)) m.set(cle, jeu);
    // « Disney's Aladdin » doit aussi se trouver sous « Aladdin »
    const nu = normaliser(jeu.Name.replace(PREFIXES, ''));
    if (nu !== cle && !m.has(nu)) m.set(nu, jeu);
  }
  return index;
}

export function disponible() {
  return fs.existsSync(INDEX_PATH);
}

export function stats() {
  const idx = charger();
  let n = 0;
  for (const m of idx.values()) n += m.size;
  return { plateformes: idx.size, jeux: n, chemin: INDEX_PATH };
}

/**
 * Cherche un jeu. `titres` peut contenir plusieurs orthographes — le titre
 * français de Dimstorted et le nom retenu côté libretro, souvent l'anglais :
 * « 007 Demain ne Meurt Jamais » n'a aucune ressemblance textuelle avec
 * « 007: Tomorrow Never Dies », et seul le second est dans LaunchBox.
 */
export function chercher(consoleId, titres) {
  const idx = charger();
  const plateformes = PLATEFORMES[consoleId] || [];
  const essais = [];
  for (const t of [].concat(titres).filter(Boolean)) essais.push(...variantes(t));

  for (const plateforme of plateformes) {
    const m = idx.get(plateforme);
    if (!m) continue;
    for (const essai of essais) {
      const cle = normaliser(essai);
      const exact = m.get(cle);
      if (exact) return { jeu: exact, plateforme, exact: true };
    }
    // Repli : préfixe seulement, et à condition que le numéro de suite colle
    for (const essai of essais) {
      const cle = normaliser(essai);
      if (cle.length < 6) continue;
      for (const [k, jeu] of m) {
        if (!memeSuite(cle, k)) continue;
        if ((k.startsWith(`${cle} `) || cle.startsWith(`${k} `))
            && Math.abs(k.length - cle.length) <= 14) {
          return { jeu, plateforme, exact: false };
        }
      }
    }
  }
  return null;
}

/** Métadonnées prêtes à fusionner, aux noms de colonnes de la base. */
export function metadonnees(consoleId, titres) {
  const hit = chercher(consoleId, titres);
  if (!hit) return null;
  const j = hit.jeu;
  const annee = j.ReleaseDate ? Number(String(j.ReleaseDate).slice(0, 4)) : null;
  const joueurs = j.MaxPlayers ? Number(j.MaxPlayers) : null;
  return {
    description: j.Overview || null,
    developer: j.Developer || null,
    publisher: j.Publisher || null,
    genre: j.Genres ? j.Genres.split(';')[0].trim() : null,
    year: Number.isInteger(annee) && annee > 1970 && annee < 2100 ? annee : null,
    players: Number.isInteger(joueurs) && joueurs > 0 ? joueurs : null,
    rating: j.CommunityRating ? Math.round(Number(j.CommunityRating) * 10) / 10 : null,
    logo: j.Logo ? urlImage(j.Logo) : null,
    fanart: j.Fanart ? urlImage(j.Fanart) : null,
    matched: j.Name,
    exact: hit.exact,
  };
}
