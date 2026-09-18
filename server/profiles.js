/**
 * Profils.
 *
 * Un ami qui passe ne doit pas écraser tes sauvegardes ni gonfler ton temps
 * de jeu. Ce qui est personnel est donc rattaché à un profil :
 *
 *   sauvegardes d'état · captures · temps de jeu · dernière partie · Ma liste
 *
 * Ce qui reste commun : le catalogue, les jaquettes, les métadonnées et les
 * émulateurs approuvés — ce sont des faits sur la machine, pas des goûts.
 *
 * Le profil actif est gardé côté serveur : Dimstorted est une application
 * locale où une seule personne joue à la fois. Le garder côté navigateur
 * obligerait chaque requête à le transporter, y compris celles du lecteur
 * dans son iframe — une occasion d'oubli de plus.
 *
 * Le schéma des tables appartient à db.js ; ce module ne porte que la logique.
 */

import fs from 'node:fs';
import path from 'node:path';
import { db, stmt, useProfile } from './db.js';
import { config, saveConfig } from './config.js';

const SAVES_DIR = path.join(config.dataPath, 'saves');
const SHOTS_DIR = path.join(config.dataPath, 'shots');

const q = {
  all: db.prepare('SELECT * FROM profiles ORDER BY id'),
  one: db.prepare('SELECT * FROM profiles WHERE id = ?'),
  byName: db.prepare('SELECT * FROM profiles WHERE name = ?'),
  add: db.prepare('INSERT INTO profiles (name, color, created_at) VALUES (?, ?, ?)'),
  del: db.prepare('DELETE FROM profiles WHERE id = ?'),
  rename: db.prepare('UPDATE profiles SET name = ?, color = ? WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM profiles'),
};

/** Couleurs d'avatar proposées, dans l'esprit des pastilles Netflix. */
export const COLORS = ['#e50914', '#0071eb', '#2ea043', '#f5a623', '#9b59b6', '#00b8a9'];

/** `data/saves/p3/game-12/…` — un dossier par profil, jamais mélangés. */
export function savesDir(profileId, gameId) {
  return path.join(SAVES_DIR, `p${profileId}`, `game-${gameId}`);
}

export function shotsDir(profileId, gameId) {
  return path.join(SHOTS_DIR, `p${profileId}`, `game-${gameId}`);
}

/**
 * Déplace les dossiers de l'époque mono-utilisateur sous le profil par défaut.
 * Sans ce déplacement, les sauvegardes existeraient encore en base mais leur
 * fichier serait introuvable : « Reprendre la partie » échouerait en silence.
 */
function relocate(root, profileId) {
  let moved = 0;
  if (!fs.existsSync(root)) return moved;

  const target = path.join(root, `p${profileId}`);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('game-')) continue;
    fs.mkdirSync(target, { recursive: true });
    try {
      fs.renameSync(path.join(root, entry.name), path.join(target, entry.name));
      moved += 1;
    } catch (err) {
      console.warn(`[profils] déplacement de ${entry.name} impossible : ${err.message}`);
    }
  }
  return moved;
}

/**
 * Premier démarrage après l'arrivée des profils : on crée le profil de
 * l'utilisateur et on y verse ce qui existait déjà, en base comme sur le
 * disque. Sans cette reprise, le temps de jeu, « Ma liste » et les
 * sauvegardes accumulés jusqu'ici seraient orphelins.
 */
const bootstrap = db.transaction(() => {
  if (q.count.get().n > 0) return null;

  const id = Number(q.add.run('Joueur 1', COLORS[0], Date.now()).lastInsertRowid);

  db.prepare(`
    INSERT OR IGNORE INTO progress (profile_id, game_id, in_list, favorite, play_seconds, last_played)
    SELECT ?, id, COALESCE(in_list, 0), COALESCE(favorite, 0),
           COALESCE(play_seconds, 0), last_played
    FROM games
  `).run(id);

  db.prepare('UPDATE saves SET profile_id = ? WHERE profile_id IS NULL').run(id);
  db.prepare('UPDATE shots SET profile_id = ? WHERE profile_id IS NULL').run(id);
  // L'URL de la vignette d'une sauvegarde est stockée telle quelle en base :
  // elle doit suivre le déplacement des fichiers.
  // Le prefixe est compose en JS : concatene par SQLite, l'identifiant
  // ressortait en « p1.0 » — un chemin qui n'existe pas.
  db.prepare(`
    UPDATE saves SET shot = REPLACE(shot, '/saves/game-', ?)
    WHERE shot LIKE '/saves/game-%'
  `).run(`/saves/p${id}/game-`);

  return id;
});

function init() {
  const created = bootstrap();
  if (created) {
    const s = relocate(SAVES_DIR, created);
    const c = relocate(SHOTS_DIR, created);
    const n = db.prepare('SELECT COUNT(*) AS n FROM progress WHERE profile_id = ?').get(created).n;
    console.log(`[profils] profil « Joueur 1 » créé — ${n} fiche(s) d'avancement, `
      + `${s} dossier(s) de sauvegardes et ${c} de captures repris`);
  }
  useProfile(currentId());
}

export function list() {
  return q.all.all();
}

export function get(id) {
  return q.one.get(id) || null;
}

/** Profil actif, avec repli sur le premier si le choix stocké a disparu. */
export function current() {
  const stored = config.activeProfile ? q.one.get(config.activeProfile) : null;
  if (stored) return stored;
  const first = q.all.all()[0] || null;
  if (first && config.activeProfile !== first.id) saveConfig({ activeProfile: first.id });
  return first;
}

export function currentId() {
  const p = current();
  return p ? p.id : null;
}

export function setCurrent(id) {
  const p = q.one.get(id);
  if (!p) throw new Error('Profil introuvable');
  saveConfig({ activeProfile: p.id });
  useProfile(p.id);
  return p;
}

export function create(name, color = COLORS[0]) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) throw new Error('Le nom ne peut pas être vide');
  if (q.byName.get(clean)) throw new Error('Ce profil existe déjà');
  if (q.count.get().n >= 6) throw new Error('Six profils au maximum');
  const picked = COLORS.includes(color) ? color : COLORS[0];
  return q.one.get(q.add.run(clean, picked, Date.now()).lastInsertRowid);
}

export function update(id, { name, color }) {
  const p = q.one.get(id);
  if (!p) throw new Error('Profil introuvable');
  const clean = name === undefined ? p.name : String(name).trim().slice(0, 24);
  if (!clean) throw new Error('Le nom ne peut pas être vide');
  const other = q.byName.get(clean);
  if (other && other.id !== id) throw new Error('Ce nom est déjà pris');
  q.rename.run(clean, COLORS.includes(color) ? color : p.color, id);
  return q.one.get(id);
}

/**
 * Supprime un profil, ses fichiers compris. Les lignes de `saves`, `shots` et
 * `progress` partent en cascade ; les fichiers, eux, ne s'effacent pas seuls.
 */
export function remove(id) {
  if (q.count.get().n <= 1) throw new Error('Impossible de supprimer le dernier profil');
  if (!q.one.get(id)) throw new Error('Profil introuvable');

  q.del.run(id);
  for (const root of [SAVES_DIR, SHOTS_DIR]) {
    try { fs.rmSync(path.join(root, `p${id}`), { recursive: true, force: true }); } catch { /* absent */ }
  }

  if (config.activeProfile === id) saveConfig({ activeProfile: null });
  const next = current();
  useProfile(next ? next.id : null);
  return next;
}

/** Quelques chiffres par profil, pour l'écran de sélection. */
export function summary(id) {
  const row = db.prepare(`
    SELECT COUNT(*) AS played, COALESCE(SUM(play_seconds), 0) AS seconds
    FROM progress WHERE profile_id = ? AND play_seconds > 0
  `).get(id);
  const saves = db.prepare('SELECT COUNT(*) AS n FROM saves WHERE profile_id = ?').get(id).n;
  const inList = db.prepare('SELECT COUNT(*) AS n FROM progress WHERE profile_id = ? AND in_list = 1').get(id).n;
  return { played: row.played, seconds: row.seconds, saves, inList };
}

export function publicProfile(p) {
  return p && { id: p.id, name: p.name, color: p.color, ...summary(p.id) };
}

/** Garantit la ligne d'avancement avant toute écriture. */
export function touchProgress(gameId, profileId = currentId()) {
  if (profileId == null) return null;
  stmt.progressEnsure.run(profileId, gameId);
  return profileId;
}

init();

export { SAVES_DIR, SHOTS_DIR };
