/**
 * Applique un lot de traductions francaises.
 *
 * Le fichier attendu est un JSON { "<id>": "<texte francais>", ... }.
 * L'original anglais est conserve : une retraduction reste possible, et la
 * fiche retombe dessus si le francais manque.
 *
 *   node scripts/appliquer-traductions.js lot.json
 */
import fs from 'node:fs';
import { db, stmt } from '../server/db.js';

const fichier = process.argv[2];
if (!fichier) { console.error('Usage: node scripts/appliquer-traductions.js <lot.json>'); process.exit(1); }

const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
let n = 0, ignores = 0;
const appliquer = db.transaction((entrees) => {
  for (const [id, texte] of entrees) {
    if (!texte || texte.length < 20) { ignores++; continue; }
    stmt.setDescriptionFr.run(texte.trim(), Number(id));
    n++;
  }
});
appliquer(Object.entries(lot));
db.pragma('wal_checkpoint(TRUNCATE)');

const reste = stmt.aTraduire.all().length;
console.log(`${n} traduction(s) appliquée(s)${ignores ? `, ${ignores} ignorée(s)` : ''} — il reste ${reste} à traduire`);
