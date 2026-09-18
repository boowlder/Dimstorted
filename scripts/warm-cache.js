/**
 * Prechauffe le cache des bases libretro.
 *
 * Le premier scraping d'une console doit telecharger son index de jaquettes
 * (jusqu'a 4 Mo de HTML) et ses bases de metadonnees. Sur une collection
 * complete, cela represente plusieurs minutes d'attente avant que la premiere
 * jaquette apparaisse.
 *
 * Ce script fait ce travail a l'avance. Une fois termine, le scraping devient
 * quasi instantane, et fonctionne meme hors ligne pendant 30 jours.
 *
 * Usage : node scripts/warm-cache.js [console1 console2 ...]
 *         sans argument, prechauffe toutes les consoles jouables.
 */

import { CONSOLES, CONSOLE_ORDER } from '../server/consoles.js';
import { candidatesFor } from '../server/scrapers/thumbnails.js';
import { fetchMetadata } from '../server/scrapers/metadata.js';
import { releaseInfo } from '../server/scrapers/releases.js';
import { stats } from '../server/scrapers/cache.js';

const asked = process.argv.slice(2);
const targets = (asked.length ? asked : CONSOLE_ORDER)
  .filter((id) => CONSOLES[id] && !CONSOLES[id].fanmade);

if (!targets.length) {
  console.error('Aucune console valide indiquée.');
  process.exit(1);
}

const before = stats();
console.log(`Préchauffage de ${targets.length} console(s).`);
console.log(`Cache actuel : ${before.files} fichier(s), ${(before.bytes / 1048576).toFixed(1)} Mo\n`);

const start = Date.now();
let ok = 0;
let empty = 0;

for (const id of targets) {
  const name = CONSOLES[id].name;
  process.stdout.write(`  ${name.padEnd(26)} `);

  // Un titre volontairement absurde : on ne cherche pas un resultat,
  // seulement a declencher la construction et la mise en cache des index.
  const probe = { id: 0, console: id, title: 'zzzz-prechauffage', region: null };
  const results = [];

  try {
    const thumbs = await candidatesFor(id);
    results.push(`${thumbs.length} jaquettes`);
  } catch (err) {
    results.push(`jaquettes: ${err.message}`);
  }

  try {
    await fetchMetadata(probe);
    results.push('métadonnées');
  } catch (err) {
    results.push(`métadonnées: ${err.message}`);
  }

  try {
    await releaseInfo(probe);
    results.push('sorties');
  } catch (err) {
    results.push(`sorties: ${err.message}`);
  }

  const line = results.join(' · ');
  if (/^0 jaquettes/.test(line)) { empty++; console.log(`— ${line}`); }
  else { ok++; console.log(`✓ ${line}`); }
}

const after = stats();
const grown = (after.bytes - before.bytes) / 1048576;
const seconds = Math.round((Date.now() - start) / 1000);

console.log(`\nTerminé en ${seconds} s.`);
console.log(`  ${ok} console(s) prête(s)${empty ? `, ${empty} sans données` : ''}`);
console.log(`  Cache : ${after.files} fichier(s), ${(after.bytes / 1048576).toFixed(1)} Mo (+${grown.toFixed(1)} Mo)`);
console.log('\nLe scraping sera désormais quasi instantané, et fonctionne hors ligne 30 jours.');
