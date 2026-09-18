/**
 * Captures d'ecran prises en cours de partie.
 *
 * Un projet souvenir merite qu'on garde ses propres moments : le boss qu'on
 * vient d'abattre, le score record, l'ecran-titre d'un jeu oublie. Ce sont
 * des images a soi, pas celles d'une base de donnees.
 *
 * Elles vivent sur le SSD a cote de la base, comme les sauvegardes : petites,
 * nombreuses, consultees souvent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import * as profiles from './profiles.js';

// Le schema de `shots` appartient a db.js, comme celui des autres tables.
const DIR = path.join(config.dataPath, 'shots');

const q = {
  add: db.prepare('INSERT INTO shots (profile_id, game_id, file, size, at) VALUES (?, ?, ?, ?, ?)'),
  byGame: db.prepare('SELECT * FROM shots WHERE profile_id = ? AND game_id = ? ORDER BY at DESC'),
  one: db.prepare('SELECT * FROM shots WHERE id = ?'),
  del: db.prepare('DELETE FROM shots WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM shots WHERE profile_id = ? AND game_id = ?'),
  ofGame: db.prepare('SELECT * FROM shots WHERE game_id = ?'),
  delOfGame: db.prepare('DELETE FROM shots WHERE game_id = ?'),
};

/** Le PNG doit vraiment en etre un : on verifie la signature. */
function isPng(buf) {
  return buf && buf.length > 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

export function add(gameId, buffer) {
  if (!isPng(buffer)) throw new Error('Image invalide (PNG attendu)');

  const profileId = profiles.currentId();
  if (profileId == null) throw new Error('Aucun profil actif');

  const dir = profiles.shotsDir(profileId, gameId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}.png`;
  fs.writeFileSync(path.join(dir, name), buffer);

  const info = q.add.run(profileId, gameId, name, buffer.length, Date.now());
  return read(info.lastInsertRowid);
}

function decorate(row) {
  if (!row) return null;
  return { ...row, url: `/shots/p${row.profile_id}/game-${row.game_id}/${row.file}` };
}

function diskPath(row) {
  return path.join(profiles.shotsDir(row.profile_id, row.game_id), row.file);
}

export function read(id) { return decorate(q.one.get(id)); }
export function list(gameId) { return q.byGame.all(profiles.currentId(), gameId).map(decorate); }
export function count(gameId) { return q.count.get(profiles.currentId(), gameId).n; }

export function remove(id) {
  const row = q.one.get(id);
  if (!row) return false;
  try { fs.unlinkSync(diskPath(row)); } catch { /* deja absent */ }
  q.del.run(id);
  return true;
}

/** Chemin disque d'une capture, pour la promouvoir en jaquette. */
export function filePath(id) {
  const row = q.one.get(id);
  if (!row) return null;
  const p = diskPath(row);
  return fs.existsSync(p) ? p : null;
}

/** Suppression d'une fiche de jeu : les captures de tous les profils partent. */
export function removeAll(gameId) {
  for (const row of q.ofGame.all(gameId)) {
    try { fs.rmSync(path.dirname(diskPath(row)), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  q.delOfGame.run(gameId);
}

export { DIR };
