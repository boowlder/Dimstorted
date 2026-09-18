/**
 * Sauvegarde et restauration de la bibliotheque.
 *
 * Ce qui est sauvegarde : le catalogue, les profils avec leurs sauvegardes de
 * parties, leurs captures, leur temps de jeu et leurs listes, les titres
 * corriges, les jaquettes, et la configuration (emulateurs approuves,
 * commandes, reglages d'image).
 *
 * Ce qui ne l'est PAS : les fichiers de jeu eux-memes. Ils pesent des
 * gigaoctets, l'utilisateur les possede deja, et les dupliquer a chaque
 * sauvegarde serait absurde. Une restauration remet donc le catalogue en
 * place ; si les jeux ont disparu du disque, Dimstorted le signalera.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, ROOT } from './config.js';

const DEST = path.join(path.dirname(config.gamesPath), 'Sauvegardes');

/** Elements a inclure, relatifs a leur racine. */
function pieces() {
  const out = [];
  const add = (root, rel) => {
    if (fs.existsSync(path.join(root, rel))) out.push({ root, rel });
  };
  add(config.dataPath, 'gameflix.db');
  add(config.dataPath, 'saves');
  // Les captures prises en jeu sont des images a soi : rien ne permettrait
  // de les retrouver ailleurs si elles disparaissaient.
  add(config.dataPath, 'shots');
  add(config.dataPath, 'covers');
  add(config.dataPath, 'controls.json');
  add(config.dataPath, 'video.json');
  add(ROOT, 'config.json');
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
}

function dirSize(p) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { total += fs.statSync(full).size; } catch { /* ignore */ } }
    }
  };
  try { fs.statSync(p).isDirectory() ? walk(p) : (total = fs.statSync(p).size); } catch { /* ignore */ }
  return total;
}

/**
 * Cree une archive datee.
 *
 * La base SQLite est en mode WAL : les ecritures recentes vivent dans un
 * fichier `-wal` separe. On force donc un point de controle avant de copier,
 * sans quoi la sauvegarde pourrait manquer les dernieres parties.
 */
export function create({ checkpoint } = {}) {
  if (typeof checkpoint === 'function') checkpoint();

  fs.mkdirSync(DEST, { recursive: true });
  const name = `gameflix_${stamp()}.tar.gz`;
  const file = path.join(DEST, name);

  const args = ['-czf', file];
  for (const p of pieces()) args.push('-C', p.root, p.rel);
  execFileSync('tar', args, { stdio: 'ignore', timeout: 20 * 60 * 1000 });

  return {
    file,
    name,
    size: fs.statSync(file).size,
    contenu: pieces().map((p) => ({ nom: p.rel, taille: dirSize(path.join(p.root, p.rel)) })),
  };
}

export function list() {
  try {
    return fs.readdirSync(DEST)
      .filter((f) => f.endsWith('.tar.gz'))
      .map((f) => {
        const s = fs.statSync(path.join(DEST, f));
        return { name: f, size: s.size, at: s.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Ne garde que les `keep` archives les plus recentes. */
export function prune(keep = 10) {
  const all = list();
  const removed = [];
  for (const b of all.slice(keep)) {
    try { fs.unlinkSync(path.join(DEST, b.name)); removed.push(b.name); } catch { /* ignore */ }
  }
  return removed;
}

export { DEST };
