/**
 * Budget de bibliothèque.
 *
 * « Je veux 10 à 15 jeux par console, 200 Go maximum » ne se vérifie pas de
 * tête : une cartouche NES pèse 200 Ko, un jeu PS2 deux mille fois plus. Un
 * quota uniforme par console donne donc un total dominé par trois machines.
 *
 * Cet outil met les chiffres à plat : ce qu'on a déjà, ce que coûterait le
 * quota visé, et ce qu'il reste sous le plafond.
 *
 *   node scripts/budget.js [--par-console 12] [--plafond 200]
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSOLES } from '../server/consoles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Poids moyen d'un jeu, en mégaoctets, dans le format le plus compact qui
 * reste jouable. Les valeurs viennent des tailles observées dans la
 * bibliothèque quand l'échantillon suffit, sinon des ordres de grandeur
 * habituels des sets Redump / No-Intro.
 *
 * Les formats comptés : CHD pour les CD (PS1, Mega-CD, Dreamcast), RVZ pour
 * le GameCube, CSO pour la PSP. Un ISO brut pèse environ le double.
 */
const POIDS_MO = {
  sg1000: 0.05,
  nes: 0.25,
  segaMS: 0.4,
  gb: 0.5,
  segaGG: 0.5,
  snes: 1.5,
  segaMD: 2,
  gba: 8,
  n64: 20,
  psx: 250,
  segaCD: 350,
  psp: 800,
  dreamcast: 800,
  gamecube: 800,
  ps2: 2500,
};

function arg(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : defaut;
}

const quota = arg('par-console', 12);
const plafondGo = arg('plafond', 200);

const db = new Database(path.join(ROOT, 'data', 'gameflix.db'), { readonly: true });
const actuel = db.prepare(`
  SELECT g.console, COUNT(DISTINCT g.id) AS n, COALESCE(SUM(f.size), 0) AS octets
  FROM games g LEFT JOIN files f ON f.game_id = g.id
  GROUP BY g.console
`).all();
const parConsole = new Map(actuel.map((r) => [r.console, r]));

const go = (mo) => mo / 1024;
const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');

// Seules les consoles qui se jouent : les plateformes fangame n'ont pas de set
const cibles = Object.entries(CONSOLES)
  .filter(([id]) => POIDS_MO[id] !== undefined)
  .sort((a, b) => POIDS_MO[a[0]] - POIDS_MO[b[0]]);

console.log(`\nObjectif : ${quota} jeux par console, plafond ${plafondGo} Go\n`);
console.log('Console                  déjà   à ajouter      poids unitaire      total');
console.log('─'.repeat(78));

let totalMo = 0;
let dejaMo = 0;
let aAjouter = 0;

for (const [id, c] of cibles) {
  const dispo = parConsole.get(id);
  const deja = dispo ? dispo.n : 0;
  const dejaCeteMo = dispo ? dispo.octets / 1e6 : 0;
  const manque = Math.max(0, quota - deja);
  const coutMo = manque * POIDS_MO[id];

  totalMo += coutMo;
  dejaMo += dejaCeteMo;
  aAjouter += manque;

  const unite = POIDS_MO[id] < 1 ? `${POIDS_MO[id] * 1000} Ko` : `${POIDS_MO[id]} Mo`;
  console.log(
    c.name.padEnd(24)
    + String(deja).padStart(4)
    + String(manque).padStart(12)
    + unite.padStart(20)
    + (coutMo >= 1024 ? `${fmt(go(coutMo))} Go` : `${Math.round(coutMo)} Mo`).padStart(11),
  );
}

console.log('─'.repeat(78));
console.log(`${String(aAjouter).padStart(28)} jeux à ajouter`
  + `${(totalMo >= 1024 ? `${fmt(go(totalMo))} Go` : `${Math.round(totalMo)} Mo`).padStart(30)}`);

const dejaGo = go(dejaMo);
const finalGo = dejaGo + go(totalMo);
console.log(`\n  déjà en bibliothèque : ${fmt(dejaGo)} Go`);
console.log(`  à télécharger        : ${fmt(go(totalMo))} Go`);
console.log(`  bibliothèque finale  : ${fmt(finalGo)} Go`);

const reste = plafondGo - finalGo;
if (reste >= 0) {
  console.log(`\n  ✅ ${fmt(reste)} Go sous le plafond de ${plafondGo} Go.`);
  // Le surplus se dépense là où il rend le plus : les gros formats sont les
  // seuls à peser, donc les seuls où le nombre de jeux se paie vraiment
  const psxEnPlus = Math.floor((reste * 1024) / POIDS_MO.psx);
  const ps2EnPlus = Math.floor((reste * 1024) / POIDS_MO.ps2);
  console.log(`     De quoi ajouter ${psxEnPlus} jeux PS1 de plus, ou ${ps2EnPlus} jeux PS2.`);
} else {
  console.log(`\n  ⚠️  ${fmt(-reste)} Go au-dessus du plafond de ${plafondGo} Go.`);
}

console.log('\n  Les cartouches (NES → N64) ne pèsent rien : les prendre toutes'
  + '\n  coûterait moins qu\'un seul jeu PS2.\n');
