/**
 * Vérification du multi-profil.
 *
 * Deux garanties à tenir, et elles cassent toutes deux en silence :
 *
 *   1. la migration d'une base mono-utilisateur ne perd rien — ni le temps de
 *      jeu, ni « Ma liste », ni les fichiers de sauvegarde sur le disque ;
 *   2. deux profils ne se voient pas — un invité ne doit ni lire, ni écraser
 *      la partie de quelqu'un d'autre.
 *
 * Le test travaille sur une COPIE de la vraie base, dans un dossier jetable.
 * Il y reproduit l'état d'avant les profils, applique la migration, puis
 * vérifie les deux garanties.
 *
 *   node scripts/smoke-profiles.js
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * config.js et db.js lisent l'environnement au moment de leur chargement : on
 * ne peut pas le changer une fois qu'ils sont importés. Le test se relance
 * donc dans un sous-processus pointé sur un dossier de données jetable — c'est
 * ce qui garantit qu'il ne touchera jamais la vraie base.
 */
if (!process.env.GAMEFLIX_DATA) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dimstorted-profils-'));
  let code = 0;
  try {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, GAMEFLIX_DATA: dir, GAMEFLIX_CONFIG: path.join(dir, 'config.json') },
    });
  } catch {
    code = 1;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

const DATA = process.env.GAMEFLIX_DATA;

/** Reconstitue une base d'avant les profils : parties jouées, listes, fichiers. */
function prepare() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'gameflix.db'), path.join(DATA, 'gameflix.db'));
  for (const ext of ['-wal', '-shm']) {
    const src = path.join(ROOT, 'data', `gameflix.db${ext}`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DATA, `gameflix.db${ext}`));
  }

  const d = new Database(path.join(DATA, 'gameflix.db'));
  d.pragma('journal_mode = WAL');

  // La copie est peut-être déjà migrée : on la ramène au schéma d'avant, pour
  // que le test vérifie toujours une vraie migration et ne dépende pas de
  // l'état du moment de la bibliothèque.
  d.exec(`
    DROP TABLE IF EXISTS progress;
    DROP TABLE IF EXISTS profiles;
    DROP TABLE IF EXISTS saves;
    DROP TABLE IF EXISTS shots;

    CREATE TABLE saves (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      slot       INTEGER NOT NULL,
      size       INTEGER NOT NULL DEFAULT 0,
      shot       TEXT,
      label      TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (game_id, slot)
    );
    CREATE TABLE shots (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      file    TEXT    NOT NULL,
      size    INTEGER NOT NULL DEFAULT 0,
      at      INTEGER NOT NULL
    );
    UPDATE games SET in_list = 0, favorite = 0, play_seconds = 0, last_played = NULL;
  `);

  const ids = d.prepare('SELECT id FROM games ORDER BY id LIMIT 3').all().map((r) => r.id);
  if (ids.length < 3) {
    console.error('Il faut au moins 3 jeux en bibliothèque pour ce test.');
    process.exit(1);
  }
  d.prepare(`UPDATE games SET play_seconds = 3600, last_played = 1758000000000, in_list = 1
             WHERE id IN (${ids.join(',')})`).run();

  for (const id of ids.slice(0, 2)) {
    d.prepare('INSERT INTO saves (game_id, slot, size, shot, label, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, 0, 1234, `/saves/game-${id}/slot-0.png?v=1`, null, Date.now());
    d.prepare('INSERT INTO saves (game_id, slot, size, shot, label, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, 3, 999, null, 'boss', Date.now());
    d.prepare('INSERT INTO shots (game_id, file, size, at) VALUES (?,?,?,?)')
      .run(id, '111.png', 50, Date.now());

    fs.mkdirSync(path.join(DATA, 'saves', `game-${id}`), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'saves', `game-${id}`, 'slot-0.state'), 'etat');
    fs.writeFileSync(path.join(DATA, 'saves', `game-${id}`, 'slot-0.png'), 'png');
    fs.mkdirSync(path.join(DATA, 'shots', `game-${id}`), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'shots', `game-${id}`, '111.png'), 'png');
  }

  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
  return ids;
}

const [G1] = prepare();

// Les modules ne sont chargés qu'ensuite : leur import déclenche la migration
const { db, stmt, listGames, getGame } = await import('../server/db.js');
const profiles = await import('../server/profiles.js');
const saves = await import('../server/saves.js');
const shots = await import('../server/shots.js');

let ko = 0;
function t(label, ok, detail = '') {
  console.log(`${ok ? '  ok   ' : '  ÉCHEC '}${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) ko += 1;
}

console.log('\n1. Reprise des données pré-profils');
const all = profiles.list();
t('un profil « Joueur 1 » créé', all.length === 1 && all[0].name === 'Joueur 1');
const joueur = all[0];

const prog = stmt.progressAll.all(joueur.id);
t('avancement repris pour tous les jeux', prog.length === listGames().length, `${prog.length} lignes`);
t('3 jeux dans « Ma liste »', prog.filter((p) => p.in_list).length === 3);
t('3 jeux avec du temps de jeu', prog.filter((p) => p.play_seconds === 3600).length === 3);

const rows = db.prepare('SELECT * FROM saves').all();
t('4 sauvegardes rattachées à Joueur 1', rows.length === 4 && rows.every((r) => r.profile_id === joueur.id));
t('URL de vignette réécrite', rows.some((r) => r.shot?.startsWith(`/saves/p${joueur.id}/game-`)),
  rows.find((r) => r.shot)?.shot);
const sh = db.prepare('SELECT * FROM shots').all();
t('2 captures rattachées à Joueur 1', sh.length === 2 && sh.every((r) => r.profile_id === joueur.id));

t('fichiers de sauvegarde déplacés',
  fs.existsSync(path.join(DATA, `saves/p${joueur.id}/game-${G1}/slot-0.state`)));
t('ancien dossier disparu', !fs.existsSync(path.join(DATA, `saves/game-${G1}`)));
t('captures déplacées', fs.existsSync(path.join(DATA, `shots/p${joueur.id}/game-${G1}/111.png`)));

console.log("\n2. Unicité par profil (l'ancienne contrainte l'interdisait)");
const invite = profiles.create('Invité', profiles.COLORS[1]);
t('second profil créé', invite?.name === 'Invité');
try {
  db.prepare('INSERT INTO saves (profile_id, game_id, slot, size, created_at) VALUES (?,?,?,?,?)')
    .run(invite.id, G1, 0, 10, Date.now());
  t('même jeu + même emplacement accepté pour un autre profil', true);
} catch (err) {
  t('même jeu + même emplacement accepté pour un autre profil', false, err.message);
}
try {
  db.prepare('INSERT INTO saves (profile_id, game_id, slot, size, created_at) VALUES (?,?,?,?,?)')
    .run(invite.id, G1, 0, 10, Date.now());
  t('doublon dans le MÊME profil refusé', false, 'insertion acceptée');
} catch {
  t('doublon dans le MÊME profil refusé', true);
}

console.log("\n3. Isolation vue depuis l'application");
profiles.setCurrent(joueur.id);
t('Joueur 1 voit son temps de jeu', getGame(G1).play_seconds === 3600);
t('Joueur 1 voit sa liste', getGame(G1).in_list === 1);
t('Joueur 1 a 2 sauvegardes sur ce jeu', saves.list(G1).length === 2);
t('Joueur 1 a 1 capture', shots.count(G1) === 1);
t('rangée « Reprendre » pour Joueur 1', saves.resumableIds().has(G1));

profiles.setCurrent(invite.id);
t('Invité repart de zéro (temps)', getGame(G1).play_seconds === 0);
t('Invité repart de zéro (liste)', getGame(G1).in_list === 0);
t('Invité a 1 sauvegarde (la sienne)', saves.list(G1).length === 1);
t("Invité n'a aucune capture", shots.count(G1) === 0);
t('listGames() suit aussi le profil', listGames().filter((g) => g.in_list).length === 0);

console.log('\n4. Écriture croisée');
saves.write(G1, 5, Buffer.alloc(64, 7), null, 'partie invité');
t("sauvegarde de l'Invité écrite dans son dossier",
  fs.existsSync(path.join(DATA, `saves/p${invite.id}/game-${G1}/slot-5.state`)));
t('le dossier de Joueur 1 est intact',
  !fs.existsSync(path.join(DATA, `saves/p${joueur.id}/game-${G1}/slot-5.state`)));

profiles.setCurrent(joueur.id);
t("Joueur 1 ne voit pas la sauvegarde de l'Invité", !saves.list(G1).some((r) => r.slot === 5));

console.log("\n5. Suppression d'un profil");
const existed = fs.existsSync(path.join(DATA, `saves/p${invite.id}`));
profiles.remove(invite.id);
t('dossier du profil supprimé', existed && !fs.existsSync(path.join(DATA, `saves/p${invite.id}`)));
t('ses lignes partent en cascade',
  db.prepare('SELECT COUNT(*) n FROM saves WHERE profile_id = ?').get(invite.id).n === 0);
t('les données de Joueur 1 sont intactes',
  saves.list(G1).length === 2 && getGame(G1).play_seconds === 3600);
try {
  profiles.remove(joueur.id);
  t('impossible de supprimer le dernier profil', false, 'suppression acceptée');
} catch {
  t('impossible de supprimer le dernier profil', true);
}

t('aucune référence orpheline', db.pragma('foreign_key_check').length === 0);

console.log(ko === 0 ? '\n✅ migration et isolation vérifiées' : `\n❌ ${ko} échec(s)`);
process.exit(ko === 0 ? 0 : 1);
