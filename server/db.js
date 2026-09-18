/**
 * Base SQLite de Dimstorted.
 *
 * Un jeu (`games`) peut porter plusieurs fichiers (`files`) : c'est ce qui
 * permet a un titre multi-CD comme Final Fantasy VII d'apparaitre comme
 * une seule fiche dans le catalogue, et non comme trois entrees.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from './config.js';

const db = new Database(path.join(config.dataPath, 'gameflix.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    color      TEXT    NOT NULL DEFAULT '#e50914',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_key    TEXT    NOT NULL UNIQUE,
    title        TEXT    NOT NULL,
    console      TEXT    NOT NULL,
    runtime      TEXT    NOT NULL,
    region       TEXT,
    year         INTEGER,
    publisher    TEXT,
    genre        TEXT,
    players      INTEGER,
    description  TEXT,
    cover        TEXT,
    added_at     INTEGER NOT NULL,
    last_played  INTEGER,
    play_seconds INTEGER NOT NULL DEFAULT 0,
    favorite     INTEGER NOT NULL DEFAULT 0,
    in_list      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS files (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id  INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    path     TEXT    NOT NULL UNIQUE,
    size     INTEGER NOT NULL DEFAULT 0,
    disc     INTEGER,
    format   TEXT
  );

  CREATE TABLE IF NOT EXISTS import_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT    NOT NULL UNIQUE,
    size         INTEGER NOT NULL DEFAULT 0,
    console      TEXT,
    confidence   TEXT    NOT NULL,
    reason       TEXT,
    title        TEXT,
    region       TEXT,
    disc         INTEGER,
    status       TEXT    NOT NULL DEFAULT 'pending',
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    slot       INTEGER NOT NULL,
    size       INTEGER NOT NULL DEFAULT 0,
    shot       TEXT,
    label      TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (profile_id, game_id, slot)
  );

  CREATE TABLE IF NOT EXISTS shots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    file       TEXT    NOT NULL,
    size       INTEGER NOT NULL DEFAULT 0,
    at         INTEGER NOT NULL
  );

  /*
   * Avancement : tout ce qui depend de QUI joue. Ces colonnes vivaient sur la
   * table games, ou elles melangeaient les parties de tout le monde.
   */
  CREATE TABLE IF NOT EXISTS progress (
    profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    in_list      INTEGER NOT NULL DEFAULT 0,
    favorite     INTEGER NOT NULL DEFAULT 0,
    play_seconds INTEGER NOT NULL DEFAULT 0,
    last_played  INTEGER,
    PRIMARY KEY (profile_id, game_id)
  );

  CREATE INDEX IF NOT EXISTS idx_games_console ON games(console);
  CREATE INDEX IF NOT EXISTS idx_games_played  ON games(last_played);
  CREATE INDEX IF NOT EXISTS idx_files_game    ON files(game_id);
  CREATE INDEX IF NOT EXISTS idx_queue_status  ON import_queue(status);
`);

/**
 * Migrations additives. SQLite ne connait pas ADD COLUMN IF NOT EXISTS :
 * on inspecte le schema avant d'ajouter, ce qui rend l'operation rejouable
 * sans risque sur une base existante.
 */
function addColumns(table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

addColumns('import_queue', {
  // Empreinte de contenu : permet de reconnaitre deux fichiers identiques
  // meme s'ils portent des noms differents
  fingerprint: 'TEXT',
});

addColumns('files', {
  fingerprint: 'TEXT',
  // La region vit sur le fichier : un meme jeu peut exister en plusieurs
  // editions regionales, qu'il ne faut surtout pas confondre avec des disques
  region: 'TEXT',
});

addColumns('games', {
  preferred_region: 'TEXT',  // edition jouee par defaut
  exclusivity: 'TEXT',       // region unique de sortie, verifiee sur No-Intro
  exclusivity_checked: 'INTEGER',
  snap: 'TEXT',            // capture de gameplay, visuel des cartes 16/9
  title_img: 'TEXT',       // ecran-titre
  // Logo detoure du jeu, sur fond transparent. C'est la signature d'ARTFLIX :
  // le titre n'est pas ecrit, il est montre tel qu'il l'etait sur la boite.
  logo: 'TEXT',
  // Illustration plein cadre, dessinee — pas une capture de jeu. C'est elle
  // qui donne a la banniere son air d'affiche plutot que d'emulateur.
  fanart: 'TEXT',
  rating: 'REAL',          // note du public LaunchBox, sur 5
  developer: 'TEXT',
  serial: 'TEXT',
  scrape_status: "TEXT NOT NULL DEFAULT 'none'", // none | ok | uncertain | notfound
  scrape_score: 'REAL',
  scrape_match: 'TEXT',    // nom retenu dans la base libretro
  scraped_at: 'INTEGER',
  // Synopsis traduit. Garde a cote de l'original : une retraduction reste
  // possible, et un texte anglais vaut mieux qu'une case vide si la
  // traduction manque.
  description_fr: 'TEXT',
});

db.exec('CREATE INDEX IF NOT EXISTS idx_games_scrape ON games(scrape_status)');

/**
 * Passage au multi-profil d'une base anterieure.
 *
 * Ajouter une colonne ne suffit pas ici : l'ancienne table `saves` portait
 * UNIQUE (game_id, slot), ce qui interdirait a deux profils d'avoir chacun
 * leur emplacement 3 sur le meme jeu. SQLite ne sait pas modifier une
 * contrainte, il faut donc reconstruire la table.
 *
 * Les cles etrangeres sont coupees le temps de l'operation (procedure
 * recommandee par SQLite) et le tout tient dans une transaction : en cas
 * d'echec, la base reste exactement dans son etat d'avant.
 */
function migrateToProfiles() {
  const savesCols = db.prepare('PRAGMA table_info(saves)').all();
  if (savesCols.some((c) => c.name === 'profile_id')) return;

  console.log('[base] migration vers le multi-profil…');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      ALTER TABLE saves RENAME TO saves_avant_profils;

      CREATE TABLE saves (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        slot       INTEGER NOT NULL,
        size       INTEGER NOT NULL DEFAULT 0,
        shot       TEXT,
        label      TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (profile_id, game_id, slot)
      );

      INSERT INTO saves (id, profile_id, game_id, slot, size, shot, label, created_at)
        SELECT id, NULL, game_id, slot, size, shot, label, created_at
        FROM saves_avant_profils;

      DROP TABLE saves_avant_profils;
    `);

    // `shots` n'a pas de contrainte a reprendre : une colonne suffit
    const shotsCols = db.prepare('PRAGMA table_info(shots)').all();
    if (shotsCols.length && !shotsCols.some((c) => c.name === 'profile_id')) {
      db.exec('ALTER TABLE shots ADD COLUMN profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE');
    }
  })();
  db.pragma('foreign_keys = ON');

  const check = db.pragma('foreign_key_check');
  if (check.length) console.warn(`[base] ${check.length} référence(s) orpheline(s) après migration`);
  console.log('[base] migration terminée');
}

migrateToProfiles();

/*
 * Index dependants du profil, crees APRES la migration — la colonne n'existe
 * pas avant. Ils sont d'abord supprimes : sur une base anterieure ils portaient
 * le meme nom mais ne couvraient que game_id, et CREATE INDEX IF NOT EXISTS les
 * aurait laisses tels quels sans rien signaler.
 */
db.exec(`
  DROP INDEX IF EXISTS idx_saves_game;
  DROP INDEX IF EXISTS idx_shots_game;
  CREATE INDEX idx_saves_game    ON saves(profile_id, game_id);
  CREATE INDEX idx_shots_game    ON shots(profile_id, game_id);
  CREATE INDEX IF NOT EXISTS idx_progress_prof ON progress(profile_id);
`);

const stmt = {
  gameByKey: db.prepare('SELECT * FROM games WHERE group_key = ?'),
  gameById: db.prepare('SELECT * FROM games WHERE id = ?'),
  insertGame: db.prepare(`
    INSERT INTO games (group_key, title, console, runtime, region, added_at)
    VALUES (@group_key, @title, @console, @runtime, @region, @added_at)
  `),
  insertFile: db.prepare(`
    INSERT OR IGNORE INTO files (game_id, path, size, disc, format, region, fingerprint)
    VALUES (@game_id, @path, @size, @disc, @format, @region, @fingerprint)
  `),
  filesByGame: db.prepare('SELECT * FROM files WHERE game_id = ? ORDER BY disc IS NULL, disc, path'),
  fileById: db.prepare('SELECT * FROM files WHERE id = ?'),
  deleteFile: db.prepare('DELETE FROM files WHERE id = ?'),
  countFiles: db.prepare('SELECT COUNT(*) AS n FROM files WHERE game_id = ?'),
  /** Un doublon exact : meme jeu, meme edition regionale, meme disque. */
  duplicateFile: db.prepare(`
    SELECT * FROM files
    WHERE game_id = ?
      AND IFNULL(region, '') = IFNULL(?, '')
      AND IFNULL(disc, 0) = IFNULL(?, 0)
  `),
  setPreferredRegion: db.prepare('UPDATE games SET preferred_region = ? WHERE id = ?'),
  setCover: db.prepare('UPDATE games SET cover = ?, scrape_status = ? WHERE id = ?'),

  savesByGame: db.prepare('SELECT * FROM saves WHERE profile_id = ? AND game_id = ? ORDER BY slot'),
  saveBySlot: db.prepare('SELECT * FROM saves WHERE profile_id = ? AND game_id = ? AND slot = ?'),
  upsertSave: db.prepare(`
    INSERT INTO saves (profile_id, game_id, slot, size, shot, label, created_at)
    VALUES (@profile_id, @game_id, @slot, @size, @shot, @label, @created_at)
    ON CONFLICT (profile_id, game_id, slot) DO UPDATE SET
      size = excluded.size,
      shot = excluded.shot,
      label = excluded.label,
      created_at = excluded.created_at
  `),
  deleteSave: db.prepare('DELETE FROM saves WHERE profile_id = ? AND game_id = ? AND slot = ?'),
  /** Toutes profils confondus : sert a la suppression d'une fiche de jeu. */
  savesOfGame: db.prepare('SELECT * FROM saves WHERE game_id = ?'),
  deleteSavesOfGame: db.prepare('DELETE FROM saves WHERE game_id = ?'),
  /** Jeux possedant une sauvegarde automatique : la rangee « Reprendre ». */
  resumable: db.prepare('SELECT DISTINCT game_id FROM saves WHERE slot = 0 AND profile_id = ?'),

  /* Avancement, par profil */
  progressGet: db.prepare('SELECT * FROM progress WHERE profile_id = ? AND game_id = ?'),
  progressAll: db.prepare('SELECT * FROM progress WHERE profile_id = ?'),
  progressEnsure: db.prepare('INSERT OR IGNORE INTO progress (profile_id, game_id) VALUES (?, ?)'),
  progressList: db.prepare('UPDATE progress SET in_list = ? WHERE profile_id = ? AND game_id = ?'),
  progressFavorite: db.prepare('UPDATE progress SET favorite = ? WHERE profile_id = ? AND game_id = ?'),
  progressTouch: db.prepare('UPDATE progress SET last_played = ? WHERE profile_id = ? AND game_id = ?'),
  progressAddTime: db.prepare('UPDATE progress SET play_seconds = play_seconds + ? WHERE profile_id = ? AND game_id = ?'),
  setExclusivity: db.prepare('UPDATE games SET exclusivity = ?, exclusivity_checked = ? WHERE id = ?'),
  fileByPath: db.prepare('SELECT * FROM files WHERE path = ?'),
  allGames: db.prepare('SELECT * FROM games ORDER BY title COLLATE NOCASE'),
  deleteGame: db.prepare('DELETE FROM games WHERE id = ?'),
  applyScrape: db.prepare(`
    UPDATE games SET
      cover = COALESCE(@cover, cover),
      snap = COALESCE(@snap, snap),
      title_img = COALESCE(@title_img, title_img),
      description = COALESCE(@description, description),
      year = COALESCE(@year, year),
      publisher = COALESCE(@publisher, publisher),
      developer = COALESCE(@developer, developer),
      genre = COALESCE(@genre, genre),
      players = COALESCE(@players, players),
      serial = COALESCE(@serial, serial),
      scrape_status = @scrape_status,
      scrape_score = @scrape_score,
      scrape_match = @scrape_match,
      scraped_at = @scraped_at
    WHERE id = @id
  `),
  setDescriptionFr: db.prepare('UPDATE games SET description_fr = ? WHERE id = ?'),
  setLogo: db.prepare('UPDATE games SET logo = ? WHERE id = ?'),
  setFanart: db.prepare('UPDATE games SET fanart = ? WHERE id = ?'),
  setRating: db.prepare('UPDATE games SET rating = ? WHERE id = ?'),
  aTraduire: db.prepare(`
    SELECT id, title, console, description FROM games
    WHERE description IS NOT NULL AND description != ''
      AND (description_fr IS NULL OR description_fr = '')
    ORDER BY id
  `),
  clearScrape: db.prepare(`
    UPDATE games SET cover = NULL, snap = NULL, title_img = NULL,
      scrape_status = 'none', scrape_score = NULL, scrape_match = NULL, scraped_at = NULL
    WHERE id = ?
  `),
  unscraped: db.prepare("SELECT * FROM games WHERE scrape_status IN ('none', 'notfound') ORDER BY id"),

  queuePending: db.prepare("SELECT * FROM import_queue WHERE status = 'pending' ORDER BY id"),
  queueByStatus: db.prepare('SELECT * FROM import_queue WHERE status = ? ORDER BY id'),
  queueByFingerprint: db.prepare('SELECT * FROM import_queue WHERE fingerprint = ? LIMIT 1'),
  fileByFingerprint: db.prepare('SELECT * FROM files WHERE fingerprint = ? LIMIT 1'),
  /**
   * Pre-filtre : deux fichiers de tailles differentes ne peuvent pas avoir le
   * meme contenu. On ne calcule donc l'empreinte — une lecture disque — que
   * lorsqu'une taille se repete quelque part.
   */
  sizeKnown: db.prepare(`
    SELECT 1 FROM files WHERE size = ?
    UNION ALL
    SELECT 1 FROM import_queue WHERE size = ?
    LIMIT 1
  `),
  queueByPath: db.prepare('SELECT * FROM import_queue WHERE path = ?'),
  queueById: db.prepare('SELECT * FROM import_queue WHERE id = ?'),
  insertQueue: db.prepare(`
    INSERT OR IGNORE INTO import_queue (path, size, console, confidence, reason, title, region, disc, fingerprint, created_at)
    VALUES (@path, @size, @console, @confidence, @reason, @title, @region, @disc, @fingerprint, @created_at)
  `),
  updateQueue: db.prepare(`
    UPDATE import_queue SET console = @console, title = @title, region = @region, disc = @disc WHERE id = @id
  `),
  setQueueStatus: db.prepare('UPDATE import_queue SET status = ? WHERE id = ?'),
  setQueueConfidence: db.prepare('UPDATE import_queue SET confidence = ?, reason = ? WHERE id = ?'),
  deleteQueue: db.prepare('DELETE FROM import_queue WHERE id = ?'),
  clearResolved: db.prepare("DELETE FROM import_queue WHERE status != 'pending'"),
};

/**
 * Rattache un fichier a un jeu, en creant le jeu s'il n'existe pas encore.
 * Le regroupement par `group_key` fusionne automatiquement les disques
 * d'un meme titre.
 */
export const attachFile = db.transaction((entry) => {
  let game = stmt.gameByKey.get(entry.group_key);
  if (!game) {
    const info = stmt.insertGame.run({
      group_key: entry.group_key,
      title: entry.title,
      console: entry.console,
      runtime: entry.runtime,
      region: entry.region ?? null,
      added_at: Date.now(),
    });
    game = stmt.gameById.get(info.lastInsertRowid);
  }
  stmt.insertFile.run({
    game_id: game.id,
    path: entry.path,
    size: entry.size ?? 0,
    disc: entry.disc ?? null,
    format: entry.format ?? null,
    region: entry.region ?? null,
    fingerprint: entry.fingerprint ?? null,
  });
  return game;
});

/**
 * Un fichier deja couvert : meme jeu, meme edition regionale, meme disque.
 * Sert a refuser un vrai doublon a l'import, sans bloquer une autre region.
 */
export function findDuplicate(groupKey, region, disc) {
  const game = stmt.gameByKey.get(groupKey);
  if (!game) return null;
  const hit = stmt.duplicateFile.get(game.id, region ?? null, disc ?? null);
  return hit ? { game, file: hit } : null;
}

/**
 * Profil actif.
 *
 * Il est tenu ici plutot que passe en argument a chaque appel : une trentaine
 * de routes lisent un jeu, et leur faire toutes transporter un identifiant de
 * profil aurait multiplie les occasions de l'oublier — donc de servir a un
 * invite les parties de quelqu'un d'autre. profiles.js est seul a l'ecrire.
 */
let activeProfileId = null;

export function useProfile(id) {
  activeProfileId = id ?? null;
}

export function activeProfileId_() {
  return activeProfileId;
}

const NO_PROGRESS = { in_list: 0, favorite: 0, play_seconds: 0, last_played: null };

/**
 * Recouvre les colonnes d'avancement par celles du profil actif. Les colonnes
 * d'origine de `games` restent en base mais ne sont plus lues : elles servent
 * de filet si la migration devait etre rejouee.
 */
function overlay(game, progress) {
  const p = progress || NO_PROGRESS;
  game.in_list = p.in_list;
  game.favorite = p.favorite;
  game.play_seconds = p.play_seconds;
  game.last_played = p.last_played;
  return game;
}

export function listGames() {
  const games = stmt.allGames.all();
  const progress = activeProfileId == null
    ? new Map()
    : new Map(stmt.progressAll.all(activeProfileId).map((r) => [r.game_id, r]));
  for (const g of games) {
    g.files = stmt.filesByGame.all(g.id);
    g.discs = g.files.length;
    overlay(g, progress.get(g.id));
  }
  return games;
}

export function getGame(id) {
  const g = stmt.gameById.get(id);
  if (!g) return null;
  g.files = stmt.filesByGame.all(g.id);
  g.discs = g.files.length;
  return overlay(g, activeProfileId == null ? null : stmt.progressGet.get(activeProfileId, id));
}

/** Colonnes que la saisie manuelle peut modifier. */
const EDITABLE_COLUMNS = new Set([
  'title', 'description', 'year', 'publisher', 'developer', 'genre', 'players',
]);

/**
 * Saisie manuelle. Indispensable pour les fangames et homebrews, absents des
 * bases libretro : sans cela ils resteraient sans titre ni jaquette.
 *
 * La requete n'est construite qu'avec les champs reellement transmis. C'est ce
 * qui permet de distinguer « champ non envoye » (on conserve) de « champ vide »
 * (on efface) — un COALESCE confondrait les deux et rendrait impossible la
 * correction d'une valeur erronee.
 */
export function updateGameFields(id, fields) {
  const keys = Object.keys(fields).filter((k) => EDITABLE_COLUMNS.has(k));
  if (!keys.length) return false;

  const setters = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE games SET ${setters} WHERE id = @id`)
    .run({ ...Object.fromEntries(keys.map((k) => [k, fields[k]])), id });
  return true;
}

export function knownPath(p) {
  return Boolean(stmt.fileByPath.get(p));
}

export { db, stmt };
