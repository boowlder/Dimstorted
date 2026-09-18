/**
 * Recupere l'habillage ARTFLIX de chaque jeu : son logo, son illustration de
 * fond, et la note du public.
 *
 * Ces deux images font toute la difference visuelle. ARTFLIX ne montre pas
 * une capture de jeu avec le titre ecrit par-dessus : il montre un dessin de
 * personnage en pied, et le lettrage d'origine pose dessus — celui de
 * Shenmue, de Metal Gear, de Sonic. On reconnait un jeu avant de l'avoir lu.
 *
 * Source : LaunchBox Games Database, deja utilisee pour les synopsis. Ses
 * images sont sur un CDN public, sans compte ni cle. libretro n'en publie
 * pas d'equivalent : son Named_Titles est une capture de l'ecran-titre, pas
 * un logo detoure, et il n'a aucune illustration dessinee.
 *
 *   node scripts/fetch-visuels.js [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import { db, stmt } from '../server/db.js';
import { config } from '../server/config.js';
import * as launchbox from '../server/scrapers/launchbox.js';

const DIR = path.join(config.dataPath, 'covers');
const force = process.argv.includes('--force');

/** Entre deux requetes : le CDN est offert, on ne le martele pas. */
const PAUSE_MS = 120;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

if (!launchbox.disponible()) {
  console.error('[visuels] index LaunchBox absent — lance d’abord scripts/fetch-launchbox.js');
  process.exit(1);
}

/**
 * Telecharge une image et l'ecrit sur le disque.
 * @returns {string|null} le chemin public, ou null si la source n'a rien donne
 */
async function recuperer(url, fichier) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Dimstorted' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Sous 512 octets ce n'est pas une image mais une page d'erreur
  if (buf.length < 512) throw new Error('image vide');
  fs.writeFileSync(path.join(DIR, fichier), buf);
  return `/covers/${fichier}`;
}

const jeux = db.prepare(
  'SELECT id, title, console, scrape_match, logo, fanart, rating FROM games ORDER BY id',
).all();

console.log(`\n${jeux.length} jeux en bibliotheque\n`);

fs.mkdirSync(DIR, { recursive: true });

const compte = { logo: 0, fanart: 0, note: 0, deja: 0, absent: 0 };
const echecs = [];

for (const jeu of jeux) {
  // Le nom retenu par libretro est souvent l'anglais : « 007 Demain ne Meurt
  // Jamais » ne ressemble pas a « 007: Tomorrow Never Dies », et seul le
  // second existe chez LaunchBox.
  const meta = launchbox.metadonnees(jeu.console, [jeu.title, jeu.scrape_match]);
  if (!meta) { compte.absent += 1; continue; }

  if (meta.rating != null && (jeu.rating == null || force)) {
    stmt.setRating.run(meta.rating, jeu.id);
    compte.note += 1;
  }

  const travaux = [];
  if (meta.logo && (!jeu.logo || force)) {
    travaux.push(['logo', meta.logo, `game-${jeu.id}-logo.png`, stmt.setLogo]);
  }
  if (meta.fanart && (!jeu.fanart || force)) {
    travaux.push(['fanart', meta.fanart, `game-${jeu.id}-fanart.jpg`, stmt.setFanart]);
  }
  if (!travaux.length) { compte.deja += 1; continue; }

  for (const [genre, url, fichier, enregistrer] of travaux) {
    try {
      const chemin = await recuperer(url, fichier);
      enregistrer.run(chemin, jeu.id);
      compte[genre] += 1;
    } catch (err) {
      echecs.push([jeu.title, genre, err.message]);
    }
    await pause(PAUSE_MS);
  }

  const fait = compte.logo + compte.fanart;
  if (fait && fait % 50 === 0) console.log(`  ${fait} images recuperees...`);
}

console.log(`
  logos recuperes        ${compte.logo}
  illustrations de fond  ${compte.fanart}
  notes renseignees      ${compte.note}
  deja complets          ${compte.deja}
  inconnus chez LaunchBox ${compte.absent}
  echecs                 ${echecs.length}`);

for (const [titre, genre, raison] of echecs.slice(0, 15)) {
  console.log(`     ${titre} (${genre}) — ${raison}`);
}

const total = db.prepare(`
  SELECT
    SUM(logo IS NOT NULL)   AS logos,
    SUM(fanart IS NOT NULL) AS fonds,
    SUM(rating IS NOT NULL) AS notes
  FROM games
`).get();
const pc = (n) => `${Math.round((n / jeux.length) * 100)} %`;
console.log(`
  en bibliotheque : ${total.logos} logos (${pc(total.logos)}), `
  + `${total.fonds} fonds (${pc(total.fonds)}), ${total.notes} notes (${pc(total.notes)})\n`);
