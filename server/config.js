/**
 * Configuration de Dimstorted.
 *
 * Les chemins sont ecrits dans config.json a la racine du projet, et
 * modifiables a la main. Les valeurs par defaut s'adaptent a la plateforme :
 * le serveur est concu pour tourner aussi bien depuis WSL2 (pour developper)
 * que nativement sous Windows (pour lancer PCSX2 et Dolphin).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Surcharges par variable d'environnement. Elles servent aux scripts de test :
 * verifier une migration ou un scenario a deux profils sur une copie de la
 * base, sans jamais risquer d'ecrire dans la vraie.
 */
const CONFIG_PATH = process.env.GAMEFLIX_CONFIG || path.join(ROOT, 'config.json');

const isWindows = process.platform === 'win32';

/** Sous WSL2, D:\ est monte sur /mnt/d. On verifie avant de le proposer. */
function defaultLibraryRoot() {
  if (isWindows) return 'D:\\GameFLIX';
  if (fs.existsSync('/mnt/d')) return '/mnt/d/GameFLIX';
  return path.join(ROOT, 'library');
}

const DEFAULTS = {
  // 8080 est trop souvent deja pris ; 1985 est libre et facile a retenir
  port: 1985,
  host: '127.0.0.1',
  // Les jeux vivent sur le HDD : gros fichiers, lecture sequentielle
  gamesPath: path.join(defaultLibraryRoot(), 'Games'),
  importPath: path.join(defaultLibraryRoot(), 'Import'),
  biosPath: path.join(defaultLibraryRoot(), 'BIOS'),
  // La base, les jaquettes et les sauvegardes vivent sur le SSD :
  // petits fichiers lus en permanence, l'interface doit rester instantanee
  dataPath: path.join(ROOT, 'data'),
  // Moteur EmulatorJS. "cdn" par defaut ; passer a "local" apres avoir
  // execute `node scripts/vendor-emulatorjs.js` pour un fonctionnement
  // 100% hors ligne.
  emulatorSource: 'cdn',
  // Scan automatique du dossier Import, en secondes (0 = desactive)
  autoScanInterval: 30,
  // Ordre de preference des editions regionales. La premiere disponible est
  // celle qui se lance ; les autres restent accessibles sur la fiche du jeu.
  regionPreference: ['France', 'Europe', 'Monde', 'USA', 'Japon'],
  // Refuser a l'import un fichier identique a un deja present
  // (meme jeu, meme region, meme disque)
  rejectDuplicates: true,
};

function load() {
  let stored = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      console.warn(`[config] config.json illisible (${err.message}), valeurs par defaut utilisees.`);
    }
  }
  const merged = { ...DEFAULTS, ...stored };
  if (process.env.GAMEFLIX_DATA) merged.dataPath = path.resolve(process.env.GAMEFLIX_DATA);
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`[config] config.json cree : ${CONFIG_PATH}`);
  }
  return merged;
}

export const config = load();

/** Cree les dossiers manquants au demarrage plutot que d'echouer plus tard. */
export function ensureDirs() {
  const dirs = [
    config.gamesPath,
    config.importPath,
    config.biosPath,
    config.dataPath,
    path.join(config.dataPath, 'covers'),
    path.join(config.dataPath, 'saves'),
  ];
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (err) {
      console.error(`[config] Impossible de creer ${d} : ${err.message}`);
    }
  }
}

// Les dossiers sont crees des le chargement de la configuration : db.js ouvre
// la base pendant l'evaluation des imports, donc avant le corps de index.js.
ensureDirs();

export function saveConfig(patch) {
  Object.assign(config, patch);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
