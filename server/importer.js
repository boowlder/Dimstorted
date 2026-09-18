/**
 * Pipeline d'import : du fichier brut a la fiche de jeu.
 *
 *   scan()    parcourt un dossier, identifie chaque fichier et remplit la
 *             file d'attente. Rien n'est deplace a ce stade.
 *   accept()  valide une entree : le fichier rejoint la bibliotheque et le
 *             jeu apparait dans le catalogue.
 *
 * Deux modes, decides par l'emplacement du fichier :
 *   - fichier depose dans le dossier Import -> il est DEPLACE dans la bibliotheque
 *   - fichier situe ailleurs (dossier existant) -> il est REFERENCE sur place
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { CONSOLES, ALL_EXT, ARCHIVE_EXT } from './consoles.js';
import { detectConsole } from './detect.js';
import { parseFilename, parseTitle, groupKey } from './titles.js';
import { config } from './config.js';
import { stmt, attachFile, knownPath, findDuplicate } from './db.js';
import * as archives from './archives.js';
import * as hashdb from './scrapers/hashdb.js';

const MAX_DEPTH = 6;

/** Parcourt un dossier en profondeur et renvoie les fichiers candidats. */
function walk(dir, depth = 0, out = []) {
  if (depth > MAX_DEPTH) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      walk(full, depth + 1, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (ALL_EXT.includes(ext)) out.push(full);
    }
  }
  return out;
}

/**
 * Fichiers satellites d'un jeu : pistes d'un .cue, disques d'un .m3u,
 * pistes d'un .gdi. Ils doivent suivre le fichier principal lors du rangement.
 */
export function companionFiles(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const found = new Set();

  const addIfExists = (name) => {
    const p = path.isAbsolute(name) ? name : path.join(dir, name);
    if (p !== filePath && fs.existsSync(p) && fs.statSync(p).isFile()) found.add(p);
  };

  try {
    if (ext === '.cue') {
      const text = fs.readFileSync(filePath, 'utf8');
      for (const m of text.matchAll(/FILE\s+(?:"([^"]+)"|(\S+))/gi)) addIfExists(m[1] || m[2]);
    } else if (ext === '.gdi') {
      /*
       * Un .gdi commence par le nombre de pistes, puis une piste par ligne :
       *   3
       *   1 0 4 2352 track01.bin 0
       *
       * Il faut donc lire ligne par ligne. Une expression reguliere globale
       * s'y casse les dents : `\s` avale les retours a la ligne, la lecture
       * demarre sur le compteur de pistes et se decale d'un champ — elle
       * capturait « 2352 », la taille de secteur, au lieu du nom de fichier.
       * Resultat : aucune piste reconnue, et chaque jeu Dreamcast entrait au
       * catalogue en autant de fiches que de pistes audio.
       */
      for (const ligne of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const champs = ligne.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(?:"([^"]+)"|(\S+))/);
        if (champs) addIfExists(champs[5] || champs[6]);
      }
    } else if (ext === '.m3u') {
      for (const line of readList(filePath)) {
        addIfExists(line);
        // Un .m3u pointe souvent vers des .cue, qui ont eux-memes des pistes
        const target = path.join(dir, line);
        if (fs.existsSync(target) && path.extname(target).toLowerCase() === '.cue') {
          for (const c of companionFiles(target)) found.add(c);
        }
      }
    }
  } catch { /* fichier index illisible : on range au moins le principal */ }

  return [...found];
}

function readList(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Analyse un dossier et alimente la file d'attente.
 * @returns {{scanned: number, queued: number, skipped: number, archives: string[]}}
 */
/**
 * Decompresse les archives rencontrees, puis relance l'analyse sur leur
 * contenu. Sans cela, chaque ROM telechargee — presque toujours zippee —
 * demanderait une manipulation prealable.
 */
export async function scanWithArchives(dir) {
  const first = scan(dir);
  if (first.error || !first.archives.length) return first;

  const extracted = [];
  const failed = [];

  for (const archive of first.archives) {
    const ext = path.extname(archive).toLowerCase();
    // Le .zip est traite en interne ; les autres formats passent par l'outil
    // systeme, s'il y en a un
    if (ext !== '.zip' && !archives.archiveTool()) {
      failed.push({
        file: path.basename(archive),
        error: `Format ${ext} : aucun outil de décompression disponible sur ce système.`,
        code: 'NO_TOOL',
      });
      continue;
    }
    try {
      const out = await archives.extract(archive);
      archives.flatten(out.dir);
      if (out.skipped.length) {
        console.warn(`[archive] ${path.basename(archive)} : ${out.skipped.length} entrée(s) refusée(s)`);
      }
      extracted.push({
        file: path.basename(archive),
        files: out.files.length,
        bytes: out.bytes,
        skipped: out.skipped,
      });
      stmt.insertQueue.run({
        path: archive,
        size: fs.statSync(archive).size,
        console: null,
        confidence: 'archive',
        reason: 'Archive décompressée',
        title: path.basename(archive),
        region: null,
        disc: null,
        fingerprint: null,
        created_at: Date.now(),
      });
      stmt.setQueueStatus.run('extracted', stmt.queueByPath.get(archive).id);
    } catch (err) {
      // yauzl rejette lui-meme les chemins remontants avant nous : on traduit
      // son message technique en quelque chose d'exploitable
      const traversal = /invalid relative path|absolute path/i.test(err.message);
      const message = traversal
        ? 'Archive refusée : elle tente d’écrire hors du dossier d’import (archive piégée ou corrompue).'
        : err.message;
      failed.push({
        file: path.basename(archive),
        error: message,
        code: traversal ? 'UNSAFE_ARCHIVE' : err.code,
      });

      // On memorise l'echec : sans cela l'archive serait retentee, et son
      // erreur reaffichee, a chaque scan automatique — toutes les 30 secondes
      stmt.insertQueue.run({
        path: archive,
        size: fs.statSync(archive).size,
        console: null,
        confidence: 'archive',
        reason: message,
        title: path.basename(archive),
        region: null,
        disc: null,
        fingerprint: null,
        created_at: Date.now(),
      });
      const row = stmt.queueByPath.get(archive);
      // « TOO_BIG » reste reessayable : l'utilisateur peut vouloir confirmer
      if (row) stmt.setQueueStatus.run(err.code === 'TOO_BIG' ? 'oversize' : 'unsafe', row.id);
    }
  }

  // Deuxieme passe : le contenu decompresse est maintenant analysable
  const second = extracted.length ? scan(dir) : { scanned: 0, queued: 0, skipped: 0 };

  // Identification exacte par CRC : elle corrige les noms de fichiers fantaisistes
  const ident = await identifyQueue().catch(() => ({ identified: 0, renamed: [] }));

  return {
    scanned: first.scanned + second.scanned,
    queued: first.queued + second.queued,
    skipped: first.skipped + second.skipped,
    identical: (first.identical || 0) + (second.identical || 0),
    archives: [],
    extracted,
    failed,
    identified: ident.identified,
    renamed: ident.renamed,
  };
}

/**
 * Enrichit la file avec l'identification exacte par CRC32.
 *
 * Passe volontairement APRÈS le scan, et seulement sur les cartouches :
 * elle lit chaque fichier en entier, ce qui n'a de sens que sur quelques
 * mégaoctets. Quand le CRC correspond à une entrée No-Intro, le titre, la
 * région et le numéro de série deviennent exacts — quel que soit le nom
 * donné au fichier.
 */
export async function identifyQueue() {
  const result = { checked: 0, identified: 0, renamed: [] };

  for (const e of stmt.queuePending.all()) {
    if (!e.console || !hashdb.supportsHashMatch(e.console)) continue;
    if (!fs.existsSync(e.path)) continue;

    result.checked++;
    let hit;
    try {
      hit = await hashdb.identify(e.path, e.console);
    } catch (err) {
      console.warn(`[crc] ${path.basename(e.path)} : ${err.message}`);
      continue;
    }
    if (!hit) continue;

    // hit.name est un titre, pas un chemin : pas d extension a retirer
    const meta = parseTitle(hit.name);
    const before = e.title;
    stmt.updateQueue.run({
      id: e.id,
      console: e.console,
      title: meta.title,
      region: meta.region ?? e.region,
      disc: meta.disc ?? e.disc,
    });
    // La détection devient certaine : le contenu a parlé, pas le nom du fichier
    stmt.setQueueConfidence.run('high', `Identifié par CRC32 ${hit.crc}`, e.id);

    result.identified++;
    if (before !== meta.title) result.renamed.push({ from: before, to: meta.title });
  }
  return result;
}

/*
 * Feuilles d'index : elles decrivent la structure du disque, pas son contenu.
 *
 * Un .gdi tient en quatre lignes — « 3 pistes, 2352 octets, track01/02/03 ».
 * Seize jeux Dreamcast differents partagent exactement le meme, a l'octet
 * pres. Les soumettre a la deduplication par contenu revient a n'en garder
 * qu'un seul : 57 fichiers tombaient a 34, et 23 jeux disparaissaient sans
 * un mot. Leur unicite se juge sur les pistes qu'elles designent, jamais sur
 * leur propre contenu.
 */
const FEUILLE_INDEX = new Set(['.gdi', '.cue', '.m3u', '.ccd', '.toc']);

export function scan(dir) {
  if (!fs.existsSync(dir)) {
    return { scanned: 0, queued: 0, skipped: 0, archives: [], error: `Dossier introuvable : ${dir}` };
  }

  const files = walk(dir);
  const found = [];
  let queued = 0;
  let skipped = 0;
  let identical = 0;

  /*
   * Pistes deja referencees par une feuille .cue, .gdi ou .m3u.
   *
   * On ne peut pas se contenter de comparer les noms : un jeu Dreamcast
   * range ses pistes en « Jeu (Track 1).bin » a cote d'un « Jeu.cue ». Sans
   * lire les feuilles, chaque piste deviendrait une fiche de jeu — Sonic
   * Adventure en produisait quatre.
   */
  const referenced = new Set();
  for (const f of files) {
    const e = path.extname(f).toLowerCase();
    if (e === '.cue' || e === '.gdi' || e === '.m3u') {
      for (const c of companionFiles(f)) referenced.add(path.resolve(c));
    }
  }

  /*
   * Les tailles rencontrees pendant ce scan. Calculer une empreinte impose de
   * lire le disque ; sur un dossier monte depuis Windows, 150 lectures coutent
   * des minutes. Or deux fichiers de tailles differentes ne peuvent pas avoir
   * le meme contenu : on ne lit donc que lorsqu'une taille se repete.
   */
  const sizesSeen = new Map();
  for (const f of files) {
    try {
      const s = fs.statSync(f).size;
      sizesSeen.set(s, (sizesSeen.get(s) || 0) + 1);
    } catch { /* fichier illisible : il sera ignore plus bas */ }
  }

  // Les fichiers deja rattaches a un jeu ou deja en file ne sont pas retraites
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();

    if (ARCHIVE_EXT.includes(ext)) {
      // Une archive deja traitee ne doit pas etre reproposee a chaque scan
      if (!stmt.queueByPath.get(file)) found.push(file);
      skipped++;
      continue;
    }
    if (knownPath(file) || stmt.queueByPath.get(file)) {
      skipped++;
      continue;
    }
    // Une piste appartenant a une feuille suit son jeu, elle n'en est pas un
    if (referenced.has(path.resolve(file))) {
      skipped++;
      continue;
    }

    const detection = detectConsole(file);
    if (detection.confidence === 'skip') {
      skipped++;
      continue;
    }

    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* taille indisponible */ }

    /*
     * Un contenu deja vu — en file ou au catalogue — n'est pas represente.
     * C'est ce qui evite qu'un meme fichier telecharge cent fois produise
     * cent fiches de jeu.
     *
     * L'empreinte n'est calculee que si la taille se repete : sinon le
     * contenu est forcement different, et la lecture disque serait gaspillee.
     */
    let fp = null;
    const sizeRepeats = (sizesSeen.get(size) || 0) > 1 || Boolean(stmt.sizeKnown.get(size, size));
    if (sizeRepeats && !FEUILLE_INDEX.has(path.extname(file).toLowerCase())) {
      fp = fingerprint(file);
      if (fp && (stmt.queueByFingerprint.get(fp) || stmt.fileByFingerprint.get(fp))) {
        identical++;
        skipped++;
        continue;
      }
    }

    const meta = parseFilename(file);

    stmt.insertQueue.run({
      path: file,
      size,
      console: detection.console,
      confidence: detection.confidence,
      reason: detection.reason,
      title: meta.title,
      region: meta.region,
      disc: meta.disc,
      fingerprint: fp,
      created_at: Date.now(),
    });
    queued++;
  }

  return { scanned: files.length, queued, skipped, identical, archives: found };
}

/**
 * Empreinte de contenu, calculee sans lire tout le fichier : taille, plus le
 * debut et la fin. Deux fichiers qui partagent les trois sont le meme contenu
 * en pratique — et un ISO de 4 Go est traite en quelques millisecondes.
 *
 * Sert a ne proposer qu'une fois un fichier telecharge en plusieurs
 * exemplaires : un installateur recupere cent fois ne doit pas produire cent
 * fiches de jeu.
 */
const EDGE = 64 * 1024;

export function fingerprint(filePath) {
  let fd;
  try {
    const size = fs.statSync(filePath).size;
    if (!size) return null;
    fd = fs.openSync(filePath, 'r');
    const hash = crypto.createHash('sha1');
    hash.update(String(size));

    const head = Buffer.alloc(Math.min(EDGE, size));
    fs.readSync(fd, head, 0, head.length, 0);
    hash.update(head);

    if (size > EDGE) {
      const tailLen = Math.min(EDGE, size - EDGE);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, size - tailLen);
      hash.update(tail);
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/** Deplacement robuste : `rename` echoue entre deux disques, on recopie alors. */
function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
  return dest;
}

/** Deplacement d'un dossier entier, avec repli sur copie entre disques. */
function moveDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
  return dest;
}

/** Evite d'ecraser un fichier existant en suffixant le nom. */
function uniquePath(dest) {
  if (!fs.existsSync(dest)) return dest;
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  for (let i = 2; i < 500; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Impossible de trouver un nom de fichier libre');
}

/**
 * Valide une entree de la file d'attente et l'ajoute au catalogue.
 * `overrides` permet de corriger la console, le titre, la region ou le disque
 * depuis l'ecran de validation.
 */
export function accept(queueId, overrides = {}) {
  const entry = stmt.queueById.get(queueId);
  if (!entry) throw new Error('Entree introuvable dans la file');

  const consoleId = overrides.console ?? entry.console;
  if (!consoleId || !CONSOLES[consoleId]) {
    throw new Error('Console non renseignee : impossible de valider');
  }
  if (!fs.existsSync(entry.path)) {
    stmt.setQueueStatus.run('missing', queueId);
    throw new Error(`Fichier introuvable : ${entry.path}`);
  }

  const console_ = CONSOLES[consoleId];
  const title = (overrides.title ?? entry.title ?? '').trim() || path.basename(entry.path);
  const region = overrides.region ?? entry.region;
  const disc = overrides.disc ?? entry.disc;
  const key = groupKey(title, consoleId);

  // Un vrai doublon, c'est le meme jeu dans la meme edition regionale et le
  // meme disque. Une autre region est une edition legitime, pas un doublon.
  if (config.rejectDuplicates && !overrides.allowDuplicate) {
    const dup = findDuplicate(key, region, disc);
    if (dup) {
      // Marque l'entree pour qu'elle sorte de la file : sans cela, le scan
      // automatique la reproposerait toutes les 30 secondes indefiniment
      stmt.setQueueStatus.run('duplicate', queueId);
      const where = region ? `édition ${region}` : 'édition sans région identifiée';
      const err = new Error(
        `Doublon : « ${dup.game.title} » (${where}${disc ? `, disque ${disc}` : ''}) est déjà au catalogue.`,
      );
      err.code = 'DUPLICATE';
      throw err;
    }
  }

  // Un fichier depose dans Import est range ; un fichier externe reste en place
  const inImportFolder = path.resolve(entry.path).startsWith(path.resolve(config.importPath));
  let finalPath = entry.path;

  if (inImportFolder) {
    const targetDir = path.join(config.gamesPath, consoleId);
    const parent = path.dirname(entry.path);
    const importRoot = path.resolve(config.importPath);

    // Un jeu HTML5 n'est pas un fichier mais une arborescence : page,
    // scripts, images, sons. Deplacer la seule page le casserait. On
    // deplace donc tout son dossier — sauf s'il est pose a la racine
    // d'Import, auquel cas ce dossier est Import lui-meme.
    if (console_.runtime === 'html5' && path.resolve(parent) !== importRoot) {
      const dest = uniquePath(path.join(targetDir, path.basename(parent)));
      moveDir(parent, dest);
      finalPath = path.join(dest, path.basename(entry.path));
      // Les autres fichiers du dossier sortent de la file : ils sont arrives
      for (const q of stmt.queuePending.all()) {
        if (path.resolve(q.path).startsWith(path.resolve(parent) + path.sep)) {
          stmt.deleteQueue.run(q.id);
        }
      }
    } else {
      const companions = companionFiles(entry.path);

      /*
       * Une image a feuille (.gdi, .cue) recoit SON PROPRE DOSSIER des
       * qu'elle a des satellites.
       *
       * Les satellites doivent garder leur nom, puisque la feuille les
       * designe par ce nom. Mais les images Dreamcast nomment toutes leurs
       * pistes « track01.bin », « track02.raw »... A plat dans un meme
       * dossier, cinquante-sept jeux reclament donc les memes fichiers : le
       * premier arrive gagne et tous les autres pointent sur ses pistes.
       * Les fiches restent valides, les fichiers existent, et chaque jeu
       * charge le contenu d'un autre — sans le moindre message.
       */
      const dossier = companions.length
        ? uniquePath(path.join(targetDir, path.basename(entry.path, path.extname(entry.path))))
        : targetDir;
      fs.mkdirSync(dossier, { recursive: true });

      finalPath = uniquePath(path.join(dossier, path.basename(entry.path)));
      for (const c of companions) {
        const dest = path.join(dossier, path.basename(c));
        if (!fs.existsSync(dest)) moveFile(c, dest);
        const queued = stmt.queueByPath.get(c);
        if (queued) stmt.deleteQueue.run(queued.id);
      }
      moveFile(entry.path, finalPath);
    }
  }

  let size = 0;
  try { size = fs.statSync(finalPath).size; } catch { /* taille indisponible */ }

  const game = attachFile({
    group_key: key,
    title,
    console: consoleId,
    runtime: console_.runtime,
    region,
    path: finalPath,
    size,
    disc,
    format: path.extname(finalPath).toLowerCase().slice(1),
    // L'empreinte suit le fichier : un contenu deja au catalogue ne sera
    // pas represente a l'import, meme sous un autre nom
    fingerprint: entry.fingerprint || fingerprint(finalPath),
  });

  stmt.deleteQueue.run(queueId);
  return game;
}

/**
 * Valide en lot les entrees de la file.
 *
 * `all: false` ne prend que les detections certaines. `all: true` prend aussi
 * les probables — un ISO PS1 est reconnu « probable » et non « sûr », or
 * valider une collection entiere a la main, entree par entree, est le genre
 * de corvee qui decourage d'utiliser l'outil. Les entrees sans console
 * identifiee restent toujours a l'arbitrage.
 *
 * Volontairement hors transaction SQLite : chaque validation deplace des
 * fichiers sur le disque, et un rollback de la base ne les ramenerait pas.
 * Chaque entree reussit ou echoue donc independamment.
 */
export function acceptAllConfident({ all = false } = {}) {
  const results = { accepted: 0, skipped: 0, failed: [] };
  for (const e of stmt.queuePending.all()) {
    if (!e.console) { results.skipped++; continue; }
    if (!all && e.confidence !== 'high') { results.skipped++; continue; }
    try {
      accept(e.id);
      results.accepted++;
    } catch (err) {
      results.failed.push({ file: path.basename(e.path), error: err.message });
    }
  }
  return results;
}

export function reject(queueId) {
  const entry = stmt.queueById.get(queueId);
  if (!entry) return false;
  stmt.deleteQueue.run(queueId);
  return true;
}

export function pending() {
  return stmt.queuePending.all();
}

/**
 * Fichiers qui ne servent plus mais occupent le disque : doublons ecartes,
 * et archives dont le contenu a deja ete extrait.
 */
export function cleanable() {
  return [
    ...stmt.queueByStatus.all('duplicate').map((e) => ({ ...e, kind: 'duplicate' })),
    ...stmt.queueByStatus.all('extracted').map((e) => ({ ...e, kind: 'archive' })),
  ].filter((e) => fs.existsSync(e.path));
}

/** Compatibilite : l'ancien nom ne designait que les doublons. */
export const rejectedDuplicates = cleanable;

/**
 * Supprime du disque les fichiers devenus inutiles.
 * Action destructive : jamais automatique, toujours a la demande.
 */
export function purgeDuplicates() {
  const entries = cleanable();
  const removed = [];
  const failed = [];
  for (const e of entries) {
    try {
      fs.unlinkSync(e.path);
      stmt.deleteQueue.run(e.id);
      removed.push(path.basename(e.path));
    } catch (err) {
      failed.push({ file: path.basename(e.path), error: err.message });
    }
  }
  return { removed, failed };
}
