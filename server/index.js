/**
 * Serveur Dimstorted.
 *
 * Ecoute sur 127.0.0.1 par defaut : rien n'est expose sur le reseau tant que
 * `host` n'est pas change dans config.json.
 */

import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs, saveConfig, ROOT } from './config.js';
import { CONSOLES, CONSOLE_ORDER } from './consoles.js';
import { db, stmt, listGames, getGame, updateGameFields } from './db.js';
import * as importer from './importer.js';
import * as scraper from './scrapers/index.js';
import { buildEditions, preferredEdition, preference } from './editions.js';
import * as saves from './saves.js';
import * as launcher from './launcher.js';
import * as controls from './controls.js';
import * as video from './video.js';
import * as backup from './backup.js';
import * as shots from './shots.js';
import * as profiles from './profiles.js';
import { genreFr } from './genres.js';
import * as cheats from './cheats.js';

ensureDirs();

const app = express();

/**
 * Protection contre les requetes forgees depuis un autre site.
 *
 * Meme en n'ecoutant que sur 127.0.0.1, Dimstorted reste joignable depuis
 * n'importe quelle page web ouverte dans le navigateur : un formulaire cache
 * vers http://127.0.0.1:1985 part sans controle prealable des lors qu'il est
 * en multipart. Un site visite pourrait ainsi deposer un fichier, ecraser une
 * sauvegarde — et demain declencher le lancement d'un programme.
 *
 * On refuse donc toute requete modifiante dont l'origine est renseignee et
 * etrangere. Une origine absente (curl, scripts, navigation directe) reste
 * acceptee : ce sont des appels qu'aucune page web ne peut fabriquer.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isLocalOrigin(value) {
  try {
    const { hostname, port } = new URL(value);
    const localHosts = ['127.0.0.1', 'localhost', '[::1]', '::1'];
    if (!localHosts.includes(hostname)) return false;
    return !port || port === String(config.port);
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('Origin') || req.get('Referer');
  if (origin && !isLocalOrigin(origin)) {
    console.warn(`[securite] requete refusee, origine etrangere : ${origin}`);
    return res.status(403).json({ error: 'Requête refusée : origine externe' });
  }
  return next();
});

/*
 * Isolation multi-origine.
 *
 * Certains coeurs d'emulation sont compiles en multi-thread — PPSSPP le
 * declare par `requireThreads: true`. Le multi-thread en WebAssembly repose
 * sur SharedArrayBuffer, que le navigateur ne rend disponible que sur une
 * page « cross-origin isolated ». Sans ces deux en-tetes, EmulatorJS echoue
 * avant meme de telecharger le coeur, avec un message sibyllin.
 *
 * `credentialless` plutot que `require-corp` : il laisse passer les
 * ressources d'autres origines qui ne declarent pas de CORP — le CDN
 * EmulatorJS et les polices Google, en l'occurrence.
 */
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

app.use(express.json());

// ---------------------------------------------------------------- Catalogue

app.get('/api/consoles', (_req, res) => {
  const counts = Object.fromEntries(
    listGames().reduce((m, g) => m.set(g.console, (m.get(g.console) || 0) + 1), new Map()),
  );
  const consoles = CONSOLE_ORDER
    .filter((id) => CONSOLES[id])
    .map((id) => ({
      id,
      ...CONSOLES[id],
      count: counts[id] || 0,
    }));
  res.json(consoles);
});

app.get('/api/games', (_req, res) => {
  res.json(listGames().map(publicGame));
});

app.get('/api/games/:id', (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json(publicGame(game));
});

/**
 * « Ce jeu vient d'etre joue » — par le profil actif, et par lui seul. La
 * ligne d'avancement est creee au besoin : un jeu n'en a aucune tant que
 * personne ne l'a touche.
 */
function markPlayed(gameId, seconds = 0) {
  const profileId = profiles.touchProgress(gameId);
  if (profileId == null) return;
  stmt.progressTouch.run(Date.now(), profileId, gameId);
  if (seconds > 0) stmt.progressAddTime.run(Math.round(seconds), profileId, gameId);
}

app.post('/api/games/:id/played', (req, res) => {
  const id = Number(req.params.id);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  const seconds = Number(req.body?.seconds);
  markPlayed(id, Number.isFinite(seconds) ? seconds : 0);
  res.json(publicGame(getGame(id)));
});

app.post('/api/games/:id/list', (req, res) => {
  const id = Number(req.params.id);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  const profileId = profiles.touchProgress(id);
  if (profileId == null) return res.status(409).json({ error: 'Aucun profil actif' });
  stmt.progressList.run(req.body?.value ? 1 : 0, profileId, id);
  res.json(publicGame(getGame(id)));
});

app.delete('/api/games/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  // Seule la fiche disparait : les fichiers de jeu sur le disque sont conserves,
  // mais les visuels telecharges n'ont plus de raison d'etre
  scraper.resetGame(id);
  saves.removeAll(id);
  shots.removeAll(id);
  stmt.deleteGame.run(id);
  res.json({ ok: true });
});

/** Ne laisse jamais fuir les chemins absolus du disque vers le navigateur. */
function publicGame(g) {
  const console_ = CONSOLES[g.console] || {};
  const editions = buildEditions(g);
  const chosen = editions.find((e) => e.preferred) || editions[0] || null;
  const auto = saves.read(g.id, saves.AUTO_SLOT);
  const allSaves = saves.list(g.id);
  return {
    // Presence d'une sauvegarde automatique : c'est elle qui fait apparaitre
    // le jeu dans « Reprendre la partie » et change le bouton en « Reprendre »
    resume: auto ? { slot: auto.slot, shot: auto.shot, at: auto.created_at, size: auto.size } : null,
    saveCount: allSaves.length,
    shotCount: shots.count(g.id),
    editions: editions.map((e) => ({
      region: e.region,
      discs: e.discs,
      size: e.size,
      preferred: e.preferred,
      // Index absolu des fichiers, pour que le lecteur demande le bon disque
      fileIds: e.files.map((f) => f.id),
    })),
    edition: chosen ? chosen.region : null,
    hasDuplicates: editions.length > 1,
    exclusivity: g.exclusivity || null,
    id: g.id,
    title: g.title,
    console: g.console,
    consoleName: console_.name || g.console,
    consoleShort: console_.short || g.console,
    runtime: g.runtime,
    core: console_.core || null,
    video: video.get(g.console),
    emulator: console_.emulator || null,
    region: g.region,
    year: g.year,
    publisher: g.publisher,
    genre: genreFr(g.genre),
    players: g.players,
    description: g.description_fr || g.description,
    descriptionVo: g.description_fr ? g.description : null,
    developer: g.developer,
    serial: g.serial,
    cover: g.cover,
    snap: g.snap,
    titleImg: g.title_img,
    logo: g.logo,
    fanart: g.fanart,
    rating: g.rating,
    // La capture de gameplay alimente les cartes 16/9 ; a defaut l'ecran-titre
    art: g.snap || g.title_img || null,
    scrapeStatus: g.scrape_status || 'none',
    scrapeScore: g.scrape_score,
    scrapeMatch: g.scrape_match,
    addedAt: g.added_at,
    lastPlayed: g.last_played,
    playSeconds: g.play_seconds,
    favorite: Boolean(g.favorite),
    inList: Boolean(g.in_list),
    // Disques et taille decrivent l'edition jouee, pas la somme de toutes
    discs: chosen ? chosen.discs : 0,
    size: chosen ? chosen.size : 0,
    format: chosen?.files[0]?.format || null,
  };
}

// ------------------------------------------------------- Livraison des ROMs

/**
 * Sert le fichier d'un jeu. Le support des requetes Range est indispensable :
 * il laisse le navigateur reprendre un telechargement interrompu et evite de
 * bufferiser un ISO de 4 Go en memoire cote serveur.
 */
app.get('/api/rom/:id', (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game || !game.files.length) return res.status(404).end('Jeu introuvable');

  // On sert l'edition preferee, sauf si une region precise est demandee
  const editions = buildEditions(game);
  const wanted = req.query.region
    ? editions.find((e) => e.region === String(req.query.region))
    : null;
  const edition = wanted || preferredEdition(game);
  if (!edition || !edition.files.length) return res.status(404).end('Aucun fichier jouable');

  const discIndex = Number(req.query.disc || 0);
  const file = edition.files[discIndex] || edition.files[0];
  if (!fs.existsSync(file.path)) {
    return res.status(410).end('Fichier absent du disque');
  }

  const stat = fs.statSync(file.path);
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(file.path))}"`);

  if (!range) {
    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(file.path).pipe(res);
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    return res.status(416).end();
  }
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (start >= stat.size || end >= stat.size || start > end) {
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    return res.status(416).end();
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(file.path, { start, end }).pipe(res);
});

// ------------------------------------------------- Jeux HTML5 (fangames)

/**
 * Sert les fichiers d'un fangame navigateur.
 *
 * Contrairement a une ROM — un fichier unique — un jeu HTML5 est un dossier
 * complet (page, scripts, images, sons). On expose donc le dossier du fichier
 * enregistre, et rien d'autre : chaque chemin demande est resolu puis verifie
 * comme etant bien a l'interieur, afin qu'un `../` ne puisse pas remonter
 * ailleurs sur le disque.
 */
app.get('/play/:id/*', (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game || !game.files.length) return res.status(404).end('Jeu introuvable');
  if (game.runtime !== 'html5') return res.status(400).end('Ce jeu n\'est pas un jeu navigateur');

  const entry = game.files[0].path;
  const root = path.resolve(path.dirname(entry));
  const requested = req.params[0] || path.basename(entry);

  const target = path.resolve(root, requested);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return res.status(403).end('Chemin hors du dossier du jeu');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return res.status(404).end('Fichier absent');
  }
  res.sendFile(target);
});

/** Redirige vers le fichier d'entree du jeu. */
app.get('/play/:id', (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game || !game.files.length) return res.status(404).end('Jeu introuvable');
  res.redirect(`/play/${game.id}/${encodeURIComponent(path.basename(game.files[0].path))}`);
});

// ------------------------------------------------------------------- Import

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.importPath),
    // On conserve le nom d'origine : il porte le titre, la region, le disque
    filename: (_req, file, cb) => cb(null, path.basename(file.originalname)),
  }),
  limits: { fileSize: 16 * 1024 * 1024 * 1024 },
});

app.post('/api/import/upload', upload.array('files'), async (req, res) => {
  try {
    const result = await importer.scanWithArchives(config.importPath);
    res.json({ uploaded: (req.files || []).length, ...result });
  } catch (err) {
    console.error('[upload]', err.stack || err);
    res.status(500).json({ error: err.message, uploaded: (req.files || []).length });
  }
});

app.post('/api/import/scan', async (req, res) => {
  const dir = req.body?.path ? String(req.body.path) : config.importPath;
  try {
    // Les archives sont decompressees au passage : une ROM zippee ne doit pas
    // demander de manipulation prealable
    res.json(await importer.scanWithArchives(dir));
  } catch (err) {
    console.error('[scan]', err.stack || err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/import/queue', (_req, res) => {
  res.json(importer.pending().map((e) => ({
    id: e.id,
    file: path.basename(e.path),
    path: e.path,
    size: e.size,
    console: e.console,
    confidence: e.confidence,
    reason: e.reason,
    title: e.title,
    region: e.region,
    disc: e.disc,
  })));
});

/**
 * Un jeu qui vient d'entrer dans la bibliotheque n'a ni jaquette ni synopsis.
 * Les recuperer demandait jusqu'ici une action separee, que rien ne signalait :
 * on importait six jeux et on se retrouvait avec six cases grises.
 *
 * La recuperation part donc toute seule apres un import. Elle tourne en fond,
 * la page suit son avancement, et `scrapeAll` refuse poliment si un travail
 * est deja en cours — inutile de se proteger davantage.
 */
function autoScrape() {
  const r = scraper.scrapeAll({ onlyMissing: true });
  if (r.started) console.log(`[scraping] lancé automatiquement pour ${r.total} jeu(x)`);
  return r;
}

app.post('/api/import/queue/:id/accept', (req, res) => {
  try {
    const game = importer.accept(Number(req.params.id), req.body || {});
    res.json({ ok: true, game: publicGame(getGame(game.id)), scraping: autoScrape().started });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/import/queue/:id/reject', (req, res) => {
  res.json({ ok: importer.reject(Number(req.params.id)) });
});

app.post('/api/import/accept-confident', (req, res) => {
  // `all` inclut les détections probables, pas seulement les certaines
  const result = importer.acceptAllConfident({ all: req.body?.all === true });
  res.json({ ...result, scraping: result.accepted > 0 && autoScrape().started });
});

/** Fichiers devenus inutiles : doublons écartés et archives déjà extraites. */
app.get('/api/import/duplicates', (_req, res) => {
  res.json(importer.cleanable().map((e) => ({
    id: e.id,
    file: path.basename(e.path),
    size: e.size,
    title: e.title,
    region: e.region,
    kind: e.kind,
  })));
});

app.post('/api/import/duplicates/purge', (_req, res) => {
  res.json(importer.purgeDuplicates());
});





// ----------------------------------------------------------- Codes de triche

app.get('/api/games/:id/cheats', async (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  if (game.runtime !== 'web') return res.json({ cheats: [], matched: null });
  try {
    const r = await cheats.forGame(game);
    res.json({ matched: r.matched, count: r.cheats.length, cheats: cheats.toEmulatorJS(r.cheats) });
  } catch (err) {
    console.warn('[triche]', err.message);
    res.json({ cheats: [], matched: null });
  }
});

// --------------------------------------------------------- Captures d'ecran

const shotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 24 * 1024 * 1024 },
});

app.post('/api/games/:id/shots', shotUpload.single('shot'), (req, res) => {
  const id = Number(req.params.id);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Aucune image reçue' });
  try {
    res.json({ ok: true, shot: shots.add(id, req.file.buffer) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/games/:id/shots', (req, res) => {
  res.json(shots.list(Number(req.params.id)));
});

app.delete('/api/shots/:shotId', (req, res) => {
  res.json({ ok: shots.remove(Number(req.params.shotId)) });
});

/** Promeut une capture en jaquette : c'est ton image, pas celle d'une base. */
app.post('/api/shots/:shotId/cover', (req, res) => {
  const shot = shots.read(Number(req.params.shotId));
  if (!shot) return res.status(404).json({ error: 'Capture introuvable' });
  const src = shots.filePath(shot.id);
  if (!src) return res.status(410).json({ error: 'Fichier absent du disque' });

  const file = `game-${shot.game_id}-custom.png`;
  fs.mkdirSync(path.join(config.dataPath, 'covers'), { recursive: true });
  fs.copyFileSync(src, path.join(config.dataPath, 'covers', file));
  // `ok` empeche le scraping automatique d'ecraser ce choix
  stmt.setCover.run(`/covers/${file}?v=${Date.now()}`, 'ok', shot.game_id);

  res.json({ ok: true, game: publicGame(getGame(shot.game_id)) });
});

// ------------------------------------------------------------- Sauvegarde

app.get('/api/backup', (_req, res) => {
  res.json({ dossier: backup.DEST, sauvegardes: backup.list() });
});

app.post('/api/backup', (_req, res) => {
  try {
    // La base est en mode WAL : sans point de controle, les dernieres
    // parties resteraient dans le journal et manqueraient a l'archive.
    const info = backup.create({ checkpoint: () => db.pragma('wal_checkpoint(TRUNCATE)') });
    const removed = backup.prune(10);
    res.json({ ok: true, ...info, purgees: removed.length });
  } catch (err) {
    console.error('[sauvegarde]', err.stack || err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------- Image par console

app.get('/api/video/:console', (req, res) => {
  const id = req.params.console;
  if (!CONSOLES[id]) return res.status(404).json({ error: 'Console inconnue' });
  res.json({ console: id, name: CONSOLES[id].name, shaders: video.SHADERS, ...video.get(id) });
});

app.put('/api/video/:console', (req, res) => {
  try {
    res.json({ ok: true, ...video.set(req.params.console, req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/video/:console', (req, res) => {
  const id = req.params.console;
  if (!CONSOLES[id]) return res.status(404).json({ error: 'Console inconnue' });
  res.json({ ok: true, ...video.reset(id) });
});

// ------------------------------------------------- Commandes par console

app.get('/api/controls/:console', (req, res) => {
  const id = req.params.console;
  if (!CONSOLES[id]) return res.status(404).json({ error: 'Console inconnue' });
  res.json({
    console: id,
    name: CONSOLES[id].name,
    profile: controls.get(id),
    layout: controls.layout(id),
    customized: controls.isCustomized(id),
  });
});

app.put('/api/controls/:console', (req, res) => {
  try {
    const profile = controls.set(req.params.console, req.body?.profile);
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/controls/:console', (req, res) => {
  const id = req.params.console;
  if (!CONSOLES[id]) return res.status(404).json({ error: 'Console inconnue' });
  res.json({ ok: true, profile: controls.reset(id) });
});

/**
 * Consoles configurables.
 *
 * Toutes celles qui passent par l'émulateur, qu'elles aient déjà des jeux ou
 * non : on règle ses touches avant d'ajouter un jeu, pas après.
 */
app.get('/api/controls', (_req, res) => {
  const counts = listGames().reduce((m, g) => m.set(g.console, (m.get(g.console) || 0) + 1), new Map());
  res.json(CONSOLE_ORDER
    .filter((id) => CONSOLES[id]?.runtime === 'web')
    .map((id) => ({
      id,
      name: CONSOLES[id].name,
      customized: controls.isCustomized(id),
      games: counts.get(id) || 0,
    })));
});

// --------------------------------------------- Lancement natif (V3)

app.get('/api/emulators', (_req, res) => {
  res.json({
    emulators: launcher.inventory(),
    wsl: launcher.IS_WSL,
    running: launcher.runningGames(),
  });
});

/**
 * Enregistre un emulateur. C'est le seul point ou un chemin fourni par
 * l'utilisateur est accepte — et il l'est pour etre approuve, pas execute.
 */
app.post('/api/emulators/:id', (req, res) => {
  const execPath = req.body?.path ? String(req.body.path).trim() : '';
  if (!execPath) return res.status(400).json({ error: 'Chemin manquant' });
  try {
    const entry = launcher.register(req.params.id, execPath);
    res.json({ ok: true, entry, emulators: launcher.inventory() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/emulators/:id', (req, res) => {
  launcher.unregister(req.params.id);
  res.json({ ok: true, emulators: launcher.inventory() });
});

/** Approbation nominative d'un fangame PC : son exécutable est le jeu. */
app.post('/api/games/:id/approve', (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  const edition = preferredEdition(game);
  if (!edition?.files.length) return res.status(400).json({ error: 'Aucun fichier' });
  try {
    const entry = launcher.approveGame(game.id, edition.files[0].path);
    res.json({ ok: true, approval: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/games/:id/approve', (req, res) => {
  launcher.revokeGame(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/games/:id/launch', async (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  if (game.runtime !== 'native') {
    return res.status(400).json({ error: 'Ce jeu se joue dans le navigateur' });
  }
  const edition = preferredEdition(game);
  if (!edition?.files.length) return res.status(400).json({ error: 'Aucun fichier jouable' });

  try {
    const info = await launcher.launch(game, edition.files[0].path);
    markPlayed(game.id);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(err.code === 'NOT_REGISTERED' ? 409 : 400)
      .json({ error: err.message, code: err.code || null, emulator: err.emulator || null });
  }
});

// ------------------------------------------------------------------ Profils

/**
 * Les profils separent ce qui appartient a quelqu'un — parties, captures,
 * temps de jeu, « Ma liste » — de ce qui appartient a la machine.
 *
 * Changer de profil est un choix serveur : le lecteur tourne dans une iframe
 * qui n'a pas connaissance de l'interface, et lui faire porter un identifiant
 * de profil dans chaque appel aurait suffi a ce qu'un oubli ecrase une partie.
 */
app.get('/api/profiles', (_req, res) => {
  res.json({
    profiles: profiles.list().map(profiles.publicProfile),
    current: profiles.currentId(),
    colors: profiles.COLORS,
  });
});

app.post('/api/profiles', (req, res) => {
  try {
    const p = profiles.create(req.body?.name, req.body?.color);
    res.json({ ok: true, profile: profiles.publicProfile(p) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/profiles/:id', (req, res) => {
  try {
    const p = profiles.update(Number(req.params.id), {
      name: req.body?.name,
      color: req.body?.color,
    });
    res.json({ ok: true, profile: profiles.publicProfile(p) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id', (req, res) => {
  try {
    const next = profiles.remove(Number(req.params.id));
    res.json({ ok: true, current: next ? next.id : null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/profiles/:id/select', (req, res) => {
  try {
    const p = profiles.setCurrent(Number(req.params.id));
    res.json({ ok: true, profile: profiles.publicProfile(p) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------ Sauvegardes d'etat (V2)

/**
 * Un etat arrive en deux morceaux : les octets de l'emulateur et une capture
 * PNG de l'ecran au moment de la sauvegarde. Multipart plutot que JSON :
 * encoder un etat PS1 de plusieurs megaoctets en base64 le gonflerait d'un
 * tiers pour rien.
 */
const saveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 96 * 1024 * 1024, files: 2 },
});

function handleSaveUpload(req, res) {
  const id = Number(req.params.id);
  const slot = Number(req.params.slot);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  if (!saves.validSlot(slot)) return res.status(400).json({ error: 'Emplacement invalide' });

  const state = req.files?.state?.[0]?.buffer;
  if (!state?.length) return res.status(400).json({ error: 'Aucun état reçu' });

  try {
    const record = saves.write(id, slot, state, req.files?.shot?.[0]?.buffer || null,
      req.body?.label ? String(req.body.label).slice(0, 80) : null);
    // Sauvegarder, c'est avoir joue : la fiche remonte dans « Reprendre »
    markPlayed(id);
    res.json({ ok: true, save: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const saveFields = saveUpload.fields([
  { name: 'state', maxCount: 1 },
  { name: 'shot', maxCount: 1 },
]);

// PUT pour un envoi normal ; POST parce que navigator.sendBeacon — le seul
// envoi encore garanti quand l'onglet se ferme — ne sait faire que du POST.
app.put('/api/games/:id/saves/:slot', saveFields, handleSaveUpload);
app.post('/api/games/:id/saves/:slot', saveFields, handleSaveUpload);

app.get('/api/games/:id/saves', (req, res) => {
  const id = Number(req.params.id);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json(saves.list(id));
});

app.get('/api/games/:id/saves/:slot', (req, res) => {
  const id = Number(req.params.id);
  const slot = Number(req.params.slot);
  if (!saves.validSlot(slot)) return res.status(400).end('Emplacement invalide');
  const file = saves.statePathFor(id, slot);
  if (!file) return res.status(404).end('Aucune sauvegarde à cet emplacement');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});

app.delete('/api/games/:id/saves/:slot', (req, res) => {
  const id = Number(req.params.id);
  const slot = Number(req.params.slot);
  if (!saves.validSlot(slot)) return res.status(400).json({ error: 'Emplacement invalide' });
  saves.remove(id, slot);
  res.json({ ok: true });
});

// ------------------------------------------------------- Saisie manuelle

/**
 * Champs modifiables a la main.
 *
 * Trois issues possibles par champ :
 *   une valeur   -> enregistree
 *   null         -> champ vide, la valeur est effacee
 *   undefined    -> saisie invalide, la requete est refusee avec un message
 *
 * Cette distinction evite qu'une annee mal tapee efface silencieusement
 * celle qui etait correcte.
 */
const text = (v) => (String(v ?? '').trim() || null);

function number(v, min, max) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

const EDITABLE = {
  title: text,
  description: text,
  publisher: text,
  developer: text,
  genre: text,
  year: (v) => number(v, 1970, 2100),
  players: (v) => number(v, 1, 16),
};

const FIELD_RULE = {
  year: 'L’année doit être comprise entre 1970 et 2100',
  players: 'Le nombre de joueurs doit être compris entre 1 et 16',
};

app.patch('/api/games/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });

  // Seuls les champs presents dans la requete sont touches ; un champ present
  // mais vide efface la valeur, ce qui permet de corriger une erreur.
  const patch = {};
  for (const [key, coerce] of Object.entries(EDITABLE)) {
    if (!Object.hasOwn(req.body || {}, key)) continue;
    const value = coerce(req.body[key]);
    if (value === undefined) {
      return res.status(400).json({ error: FIELD_RULE[key] || `Valeur invalide pour « ${key} »` });
    }
    patch[key] = value;
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }
  // Un titre vide laisserait un jeu sans nom : on refuse plutot que d'effacer
  if (Object.hasOwn(patch, 'title') && !patch.title) {
    return res.status(400).json({ error: 'Le titre ne peut pas être vide' });
  }

  updateGameFields(id, patch);
  res.json({ ok: true, game: publicGame(getGame(id)) });
});

/** Jaquette fournie par l'utilisateur, pour les jeux absents des bases. */
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

app.post('/api/games/:id/cover', coverUpload.single('cover'), (req, res) => {
  const id = Number(req.params.id);
  if (!getGame(id)) return res.status(404).json({ error: 'Jeu introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Aucune image reçue' });

  const ext = (path.extname(req.file.originalname) || '.png').toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    return res.status(400).json({ error: 'Format d’image non pris en charge' });
  }
  const file = `game-${id}-custom${ext}`;
  fs.mkdirSync(path.join(config.dataPath, 'covers'), { recursive: true });
  fs.writeFileSync(path.join(config.dataPath, 'covers', file), req.file.buffer);
  // `ok` evite que le scraping automatique vienne ecraser un choix manuel
  stmt.setCover.run(`/covers/${file}`, 'ok', id);

  res.json({ ok: true, game: publicGame(getGame(id)) });
});

// --------------------------------------------------- Editions et doublons

/** Jeux presents en plusieurs editions regionales, a arbitrer. */
app.get('/api/duplicates', (_req, res) => {
  const out = listGames()
    .map(publicGame)
    .filter((g) => g.hasDuplicates);
  res.json({ preference: preference(), games: out });
});

app.post('/api/games/:id/edition', (req, res) => {
  const id = Number(req.params.id);
  const game = getGame(id);
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });

  const region = req.body?.region ? String(req.body.region) : null;
  if (region && !buildEditions(game).some((e) => e.region === region)) {
    return res.status(400).json({ error: `Aucune édition « ${region} » pour ce jeu` });
  }
  // null remet le choix automatique selon l'ordre de preference
  stmt.setPreferredRegion.run(region, id);
  res.json({ ok: true, game: publicGame(getGame(id)) });
});

/**
 * Retire une edition du catalogue. Le fichier n'est efface du disque que si
 * `deleteFiles` est explicitement demande.
 */
app.delete('/api/games/:id/edition/:region', (req, res) => {
  const id = Number(req.params.id);
  const game = getGame(id);
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });

  const editions = buildEditions(game);
  if (editions.length < 2) {
    return res.status(400).json({ error: 'Impossible de retirer la seule édition du jeu' });
  }
  const edition = editions.find((e) => e.region === req.params.region);
  if (!edition) return res.status(404).json({ error: 'Édition introuvable' });

  const removeFromDisk = req.query.deleteFiles === '1';
  const removed = [];
  for (const f of edition.files) {
    if (removeFromDisk) {
      try { fs.unlinkSync(f.path); } catch { /* deja absent */ }
    }
    stmt.deleteFile.run(f.id);
    removed.push(path.basename(f.path));
  }
  if (game.preferred_region === edition.region) stmt.setPreferredRegion.run(null, id);

  res.json({ ok: true, removed, deletedFromDisk: removeFromDisk, game: publicGame(getGame(id)) });
});

app.get('/api/regions', (_req, res) => {
  res.json({ preference: preference() });
});

app.post('/api/regions', (req, res) => {
  const list = req.body?.preference;
  if (!Array.isArray(list) || !list.length || !list.every((r) => typeof r === 'string')) {
    return res.status(400).json({ error: 'Liste de régions invalide' });
  }
  saveConfig({ regionPreference: list });
  res.json({ ok: true, preference: preference() });
});

// ------------------------------------------------------------------ Scraping

app.post('/api/scrape/all', (req, res) => {
  res.json(scraper.scrapeAll({ onlyMissing: req.body?.onlyMissing !== false }));
});

app.get('/api/scrape/status', (_req, res) => {
  res.json(scraper.status());
});

app.post('/api/games/:id/scrape', async (req, res) => {
  try {
    const r = await scraper.scrapeGame(Number(req.params.id), { force: req.body?.match || null });
    res.json({ ok: true, status: r.status, game: publicGame(r.game) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/games/:id/scrape/reset', (req, res) => {
  const game = scraper.resetGame(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  res.json({ ok: true, game: publicGame(game) });
});

/** Propositions pour corriger a la main une correspondance ratee. */
app.get('/api/games/:id/candidates', async (req, res) => {
  const game = getGame(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Jeu introuvable' });
  try {
    const q = String(req.query.q || game.title);
    res.json(await scraper.suggest(game.console, q));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/scrape/cache/clear', (_req, res) => {
  res.json(scraper.clearCache());
});

// -------------------------------------------------------------- Diagnostics

app.get('/api/status', (_req, res) => {
  const games = listGames();
  const missingBios = [];
  for (const [id, c] of Object.entries(CONSOLES)) {
    if (!c.bios?.required) continue;
    const present = c.bios.files.some((f) => fs.existsSync(path.join(config.biosPath, f)));
    if (!present && games.some((g) => g.console === id)) {
      missingBios.push({ console: id, name: c.name, files: c.bios.files });
    }
  }
  const byScrape = games.reduce((m, g) => {
    const k = g.scrape_status || 'none';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});

  res.json({
    games: games.length,
    pending: importer.pending().length,
    scrape: {
      ok: byScrape.ok || 0,
      uncertain: byScrape.uncertain || 0,
      notfound: byScrape.notfound || 0,
      none: byScrape.none || 0,
      cache: scraper.cacheStats(),
    },
    paths: {
      games: config.gamesPath,
      import: config.importPath,
      bios: config.biosPath,
    },
    emulatorSource: config.emulatorSource,
    // Les visuels de `public/theme/` sont facultatifs : ils viennent d'un
    // theme tiers qu'on ne redistribue pas. Sans eux l'interface se rabat sur
    // les noms de consoles et des aplats de couleur.
    theme: fs.existsSync(path.join(ROOT, 'public', 'theme', 'logos')),
    missingBios,
  });
});

// ------------------------------------------------------------------ Statique

/*
 * Application locale : le navigateur ne doit jamais servir une version
 * perimee de l'interface. Sur 127.0.0.1 le cout d'une revalidation est nul,
 * et cela evite la confusion « c'est corrige mais je ne le vois pas ».
 */
app.use((req, res, next) => {
  if (/\.(html|css|js)$/.test(req.path) || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
  next();
});

app.use('/covers', express.static(path.join(config.dataPath, 'covers')));
app.use('/saves', express.static(saves.SAVES_DIR));
app.use('/shots', express.static(shots.DIR));
app.use(express.static(path.join(ROOT, 'public')));

// Le moteur EmulatorJS : CDN par defaut, dossier local si vendorise
if (config.emulatorSource === 'local') {
  app.use('/emulatorjs', express.static(path.join(ROOT, 'public', 'emulatorjs')));
}

app.get('/api/emulator-path', (_req, res) => {
  res.json({
    path: config.emulatorSource === 'local'
      ? '/emulatorjs/data/'
      : 'https://cdn.emulatorjs.org/stable/data/',
    source: config.emulatorSource,
  });
});

app.use((err, _req, res, _next) => {
  console.error('[erreur]', err);
  res.status(500).json({ error: err.message });
});

// Un port occupe est le premier accroc qu'on rencontre : on l'explique
// plutot que de dérouler une pile d'erreurs.
app.on('error', () => {});

/*
 * Express 4 ne rattrape pas les erreurs des gestionnaires asynchrones : une
 * exception dans une route `async` devient un rejet non traite, et abattait
 * le serveur entier. Un import rate ne doit pas couper la musique — on
 * journalise et on continue.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[erreur non traitée]', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${config.port} est deja utilise par un autre programme.`);
    console.error('  Change la ligne "port" dans config.json, puis relance.\n');
    process.exit(1);
  }
  console.error('[erreur fatale évitée]', err.stack || err);
});

const server = app.listen(config.port, config.host, () => {
  console.log('');
  console.log('  ██████  Dimstorted');
  console.log(`  Interface   http://${config.host}:${config.port}`);
  console.log(`  Jeux        ${config.gamesPath}`);
  console.log(`  Import      ${config.importPath}`);
  console.log(`  BIOS        ${config.biosPath}`);
  console.log('');
});

// Scan periodique du dossier Import : deposer un fichier suffit a le voir
// apparaitre dans la file de validation, sans clic.
if (config.autoScanInterval > 0) {
  setInterval(() => {
    try {
      const r = importer.scan(config.importPath);
      if (r.queued) console.log(`[auto-scan] ${r.queued} nouveau(x) fichier(s) en attente de validation`);
    } catch (err) {
      console.error('[auto-scan]', err.message);
    }
  }, config.autoScanInterval * 1000).unref();
}

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
