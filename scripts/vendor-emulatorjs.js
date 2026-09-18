/**
 * Bascule Dimstorted en fonctionnement 100 % hors ligne.
 *
 * Telecharge le paquet complet EmulatorJS (moteur + tous les coeurs) et
 * l'installe dans public/emulatorjs/. Une fois l'operation terminee, plus
 * aucune requete ne sort de la machine : ni le moteur, ni les coeurs.
 *
 * Prerequis : l'archive est au format .7z, il faut donc 7z sur le systeme.
 *   Debian / Ubuntu / WSL :  sudo apt install p7zip-full
 *   Windows               :  https://www.7-zip.org
 *
 * Usage : node scripts/vendor-emulatorjs.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT, saveConfig } from '../server/config.js';

const RELEASE_API = 'https://api.github.com/repos/EmulatorJS/EmulatorJS/releases/latest';
const DEST = path.join(ROOT, 'public', 'emulatorjs');
const TMP = path.join(ROOT, '.emulatorjs-download');

function have7z() {
  for (const bin of ['7z', '7za', '7zr']) {
    if (spawnSync(bin, ['--help'], { stdio: 'ignore' }).status !== null) return bin;
  }
  return null;
}

const sevenZip = have7z();
if (!sevenZip) {
  console.error('7z est introuvable. Installe-le puis relance :');
  console.error('  sudo apt install p7zip-full       (Linux / WSL)');
  console.error('  https://www.7-zip.org             (Windows)');
  process.exit(1);
}

console.log('Recherche de la derniere version d EmulatorJS...');
const release = await fetch(RELEASE_API, {
  headers: { 'User-Agent': 'Dimstorted' },
}).then((r) => r.json());

const asset = (release.assets || []).find((a) => a.name.endsWith('.7z'));
if (!asset) {
  console.error('Aucune archive .7z dans la derniere version. Abandon.');
  process.exit(1);
}

const sizeMo = (asset.size / 1048576).toFixed(0);
console.log(`Version ${release.tag_name} — ${asset.name} (${sizeMo} Mo)`);
console.log('Telechargement... (c est long, tous les coeurs y sont)');

fs.mkdirSync(TMP, { recursive: true });
const archive = path.join(TMP, asset.name);

const res = await fetch(asset.browser_download_url);
if (!res.ok) {
  console.error(`Telechargement impossible : HTTP ${res.status}`);
  process.exit(1);
}
const total = Number(res.headers.get('content-length')) || asset.size;
let received = 0;
let lastPct = -1;
const out = fs.createWriteStream(archive);
for await (const chunk of res.body) {
  received += chunk.length;
  out.write(chunk);
  const pct = Math.floor((received / total) * 100);
  if (pct !== lastPct && pct % 5 === 0) {
    process.stdout.write(`\r  ${pct}%  (${(received / 1048576).toFixed(0)} / ${sizeMo} Mo)`);
    lastPct = pct;
  }
}
out.end();
await new Promise((r) => out.on('close', r));
console.log('\nExtraction...');

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
execFileSync(sevenZip, ['x', archive, `-o${DEST}`, '-y'], { stdio: 'inherit' });

// Le paquet peut contenir un dossier racine : on le remonte d un niveau
const entries = fs.readdirSync(DEST, { withFileTypes: true });
if (entries.length === 1 && entries[0].isDirectory()) {
  const inner = path.join(DEST, entries[0].name);
  for (const f of fs.readdirSync(inner)) {
    fs.renameSync(path.join(inner, f), path.join(DEST, f));
  }
  fs.rmdirSync(inner);
}

if (!fs.existsSync(path.join(DEST, 'data', 'loader.js'))) {
  console.error('Attention : data/loader.js est introuvable apres extraction.');
  console.error(`Verifie le contenu de ${DEST} avant de basculer en mode local.`);
  process.exit(1);
}

fs.rmSync(TMP, { recursive: true, force: true });
saveConfig({ emulatorSource: 'local' });

console.log('');
console.log('Termine. Dimstorted fonctionne maintenant entierement hors ligne.');
console.log(`  Moteur : ${DEST}`);
console.log('  config.json : emulatorSource = "local"');
console.log('Redemarre le serveur pour appliquer.');
