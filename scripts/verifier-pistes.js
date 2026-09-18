/**
 * Vérifie que chaque image à feuille lit bien SES pistes.
 *
 * Le contrôle évident — « le fichier existe-t-il ? » — ne sert à rien ici.
 * Les images Dreamcast nomment toutes leurs pistes `track01.bin`,
 * `track02.raw`... Rangées à plat dans un même dossier, cinquante-sept jeux
 * désignent les mêmes fichiers : chaque feuille trouve tout ce qu'elle
 * cherche, et charge pourtant le contenu d'un autre jeu. C'est arrivé, et
 * rien ne l'avait signalé.
 *
 * Ce script compare donc l'empreinte de chaque piste rangée avec celle de la
 * piste d'origine, restée dans le dossier d'extraction. Deux jeux ne peuvent
 * pas partager une piste de données.
 *
 *   node scripts/verifier-pistes.js
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';
import { config } from '../server/config.js';

const FEUILLES = new Set(['.gdi', '.cue', '.m3u']);

/** Empreinte rapide : taille + premier mégaoctet. Suffit à distinguer. */
function empreinte(p) {
  const taille = fs.statSync(p).size;
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(Math.min(taille, 1 << 20));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return `${taille}:${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}`;
}

/** Pistes désignées par une feuille, dans l'ordre. */
function pistesDe(feuille) {
  const ext = path.extname(feuille).toLowerCase();
  const texte = fs.readFileSync(feuille, 'utf8');
  const noms = [];
  if (ext === '.gdi') {
    for (const ligne of texte.split(/\r?\n/)) {
      const m = ligne.trim().match(/^\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))/);
      if (m) noms.push(m[1] || m[2]);
    }
  } else if (ext === '.cue') {
    for (const m of texte.matchAll(/FILE\s+(?:"([^"]+)"|(\S+))/gi)) noms.push(m[1] || m[2]);
  }
  return noms;
}

const jeux = db.prepare(`
  SELECT g.id, g.title, g.console, f.path
  FROM games g JOIN files f ON f.game_id = g.id
`).all().filter((r) => FEUILLES.has(path.extname(r.path).toLowerCase()));

console.log(`\n${jeux.length} image(s) à feuille en bibliothèque\n`);

let ok = 0;
const absentes = [];
const partagees = [];

// Une piste de donnees ne peut appartenir qu'a un jeu : si deux feuilles
// pointent sur la meme empreinte, l'une des deux lit le mauvais contenu.
const vues = new Map();

for (const jeu of jeux) {
  const dossier = path.dirname(jeu.path);
  const noms = pistesDe(jeu.path);
  const manquantes = noms.filter((n) => !fs.existsSync(path.join(dossier, n)));

  if (manquantes.length) {
    absentes.push([jeu.title, manquantes.length, noms.length]);
    continue;
  }

  // La piste 1 porte les donnees : c'est elle qui identifie le jeu
  const piste1 = path.join(dossier, noms[0]);
  const emp = empreinte(piste1);
  if (vues.has(emp)) {
    partagees.push([jeu.title, vues.get(emp)]);
  } else {
    vues.set(emp, jeu.title);
    ok += 1;
  }
}

console.log(`  pistes présentes et contenu unique : ${ok}/${jeux.length}`);

if (absentes.length) {
  console.log(`\n  ❌ ${absentes.length} jeu(x) avec des pistes manquantes :`);
  for (const [t, m, n] of absentes.slice(0, 10)) console.log(`     ${t} — ${m}/${n} manquante(s)`);
}

if (partagees.length) {
  console.log(`\n  ❌ ${partagees.length} jeu(x) partagent la piste d'un autre :`);
  for (const [a, b] of partagees.slice(0, 10)) console.log(`     « ${a} » lit la piste de « ${b} »`);
}

const bon = !absentes.length && !partagees.length;
console.log(bon ? '\n✅ chaque jeu lit bien ses propres pistes\n' : '\n❌ contrôle échoué\n');
process.exit(bon ? 0 : 1);
