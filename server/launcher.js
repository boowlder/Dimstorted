/**
 * Lancement des jeux natifs.
 *
 * C'est la seule partie de Dimstorted qui execute un programme. Elle est batie
 * sur trois regles, dans cet ordre d'importance :
 *
 *  1. RIEN N'EST LANCE QUI N'AIT ETE APPROUVE.
 *     Un executable doit d'abord etre enregistre explicitement. Le serveur
 *     n'accepte jamais un chemin transmis dans une requete : il ne connait
 *     que des identifiants, resolus dans sa propre configuration.
 *
 *  2. L'EMPREINTE EST REVERIFIEE A CHAQUE LANCEMENT.
 *     Le SHA-256 releve a l'enregistrement est recalcule avant d'executer.
 *     Si le binaire a change depuis, on refuse. C'est ce qui rend Dimstorted
 *     plus sur qu'un double-clic : un double-clic, lui, ne remarque rien.
 *
 *  3. AUCUN SHELL, JAMAIS.
 *     `spawn` recoit un tableau d'arguments. Un jeu nomme `Sonic"; rm -rf ~`
 *     est transmis tel quel a l'emulateur, comme un simple nom de fichier.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config, saveConfig } from './config.js';
import { EMULATORS, SELF_LAUNCHING, emulatorFor } from './emulators.js';
import { CONSOLES } from './consoles.js';

/** Sous WSL, les executables Windows attendent des chemins Windows. */
const IS_WSL = process.platform === 'linux' && /microsoft/i.test(os.release());

/** `/mnt/d/Jeux/x.iso` -> `D:\Jeux\x.iso` */
export function toWindowsPath(p) {
  const m = /^\/mnt\/([a-z])\/(.*)$/i.exec(p);
  if (!m) return p;
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

function isWindowsBinary(p) {
  return /\.(exe|bat|cmd)$/i.test(p);
}

export function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function registry() {
  if (!config.emulatorPaths || typeof config.emulatorPaths !== 'object') {
    config.emulatorPaths = {};
  }
  return config.emulatorPaths;
}

/**
 * Enregistre un executable. C'est l'unique moment ou un chemin fourni par
 * l'utilisateur entre dans le systeme, et il y entre approuve.
 */
export function register(id, execPath) {
  if (!EMULATORS[id]) throw new Error(`Émulateur inconnu : ${id}`);

  const resolved = path.resolve(execPath);
  if (!fs.existsSync(resolved)) throw new Error(`Fichier introuvable : ${resolved}`);
  if (!fs.statSync(resolved).isFile()) throw new Error('Ce chemin n’est pas un fichier');

  const entry = {
    path: resolved,
    sha256: sha256(resolved),
    size: fs.statSync(resolved).size,
    registeredAt: Date.now(),
  };
  registry()[id] = entry;
  saveConfig({ emulatorPaths: registry() });
  return entry;
}

export function unregister(id) {
  delete registry()[id];
  saveConfig({ emulatorPaths: registry() });
}

/** Etat du catalogue : ce qui est approuve, ce qui reste a installer. */
export function inventory() {
  const reg = registry();
  return Object.entries(EMULATORS).map(([id, e]) => {
    const entry = reg[id];
    let state = 'absent';
    if (entry) {
      if (!fs.existsSync(entry.path)) state = 'missing';
      else state = sha256(entry.path) === entry.sha256 ? 'ready' : 'changed';
    }
    return {
      id,
      name: e.name,
      console: e.console,
      consoleName: e.console ? CONSOLES[e.console]?.name : 'Toutes',
      source: e.source,
      repo: e.repo,
      license: e.license,
      note: e.note,
      binaries: e.binaries,
      path: entry?.path || null,
      sha256: entry?.sha256 || null,
      state,
    };
  });
}

/** Jeux approuves individuellement (fangames PC). */
function approvedGames() {
  if (!config.approvedGames || typeof config.approvedGames !== 'object') {
    config.approvedGames = {};
  }
  return config.approvedGames;
}

export function approveGame(gameId, filePath) {
  const resolved = path.resolve(filePath);
  // Confinement : un jeu approuve doit vivre dans la bibliotheque
  const root = path.resolve(config.gamesPath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Seuls les fichiers de la bibliothèque peuvent être approuvés');
  }
  if (!fs.existsSync(resolved)) throw new Error('Fichier introuvable');

  const entry = { path: resolved, sha256: sha256(resolved), approvedAt: Date.now() };
  approvedGames()[String(gameId)] = entry;
  saveConfig({ approvedGames: approvedGames() });
  return entry;
}

export function gameApproval(gameId) {
  return approvedGames()[String(gameId)] || null;
}

export function revokeGame(gameId) {
  delete approvedGames()[String(gameId)];
  saveConfig({ approvedGames: approvedGames() });
}

const running = new Map();

/**
 * Lance un jeu natif.
 * @param {object} game  fiche complete, telle que renvoyee par getGame
 * @param {string} romPath  chemin du fichier a ouvrir, issu de la base
 */
export function launch(game, romPath) {
  const consoleId = game.console;
  const selfLaunching = SELF_LAUNCHING.has(consoleId);

  let execPath;
  let args;
  let expectedHash;

  if (selfLaunching) {
    // Le jeu est son propre programme : il doit avoir ete approuve nommement
    const approval = gameApproval(game.id);
    if (!approval) {
      const err = new Error('Ce jeu doit être approuvé avant d’être lancé');
      err.code = 'NEEDS_APPROVAL';
      throw err;
    }
    execPath = approval.path;
    expectedHash = approval.sha256;
    args = [];
  } else {
    const emuId = emulatorFor(consoleId);
    if (!emuId) throw new Error(`Aucun émulateur connu pour ${consoleId}`);
    const entry = registry()[emuId];
    if (!entry) {
      const err = new Error(`${EMULATORS[emuId].name} n’est pas encore enregistré`);
      err.code = 'NOT_REGISTERED';
      err.emulator = emuId;
      throw err;
    }
    execPath = entry.path;
    expectedHash = entry.sha256;

    // Les chemins passes a un binaire Windows doivent etre au format Windows
    const rom = IS_WSL && isWindowsBinary(execPath) ? toWindowsPath(romPath) : romPath;
    const template = config.emulatorArgs?.[emuId] || EMULATORS[emuId].args;
    args = template.map((a) => a.replace('{rom}', rom));
  }

  if (!fs.existsSync(execPath)) {
    throw new Error(`Programme introuvable : ${execPath}`);
  }

  // Regle 2 : l'empreinte doit correspondre a celle approuvee
  const actual = sha256(execPath);
  if (actual !== expectedHash) {
    const err = new Error(
      'Le programme a changé depuis son approbation — lancement refusé. '
      + 'Réapprouve-le si la modification est légitime (mise à jour).',
    );
    err.code = 'HASH_MISMATCH';
    throw err;
  }

  // Regle 3 : tableau d'arguments, jamais de shell
  const child = spawn(execPath, args, {
    // Un cwd WSL ferait rater le repertoire de travail a un binaire Windows
    cwd: path.dirname(execPath),
    detached: true,
    stdio: 'ignore',
    shell: false,
  });

  /*
   * spawn est asynchrone : un programme introuvable ou non executable
   * n'echoue qu'apres le retour de la fonction. Repondre « lancé » sans
   * attendre donnerait un succes de facade — l'utilisateur verrait une
   * confirmation, et rien ne s'ouvrirait. On laisse donc un court delai
   * a l'erreur pour se manifester avant de conclure.
   */
  return new Promise((resolve, reject) => {
    let settled = false;

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      running.delete(game.id);
      const e = new Error(`Impossible de lancer ${path.basename(execPath)} : ${err.message}`);
      e.code = 'SPAWN_FAILED';
      reject(e);
    });

    // Un programme qui rend la main immediatement avec un code d'erreur
    // n'a pas demarre non plus
    child.once('exit', (code) => {
      running.delete(game.id);
      if (settled || code === 0 || code === null) return;
      settled = true;
      const e = new Error(`${path.basename(execPath)} s’est arrêté aussitôt (code ${code})`);
      e.code = 'SPAWN_FAILED';
      reject(e);
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      running.set(game.id, { pid: child.pid, title: game.title, startedAt: Date.now() });
      console.log(`[lancement] ${game.title} → ${path.basename(execPath)} (pid ${child.pid})`);
      resolve({ pid: child.pid, exec: path.basename(execPath), args });
    }, 600);
  });
}

export function runningGames() {
  return [...running.entries()].map(([gameId, r]) => ({ gameId, ...r }));
}

export { IS_WSL };
