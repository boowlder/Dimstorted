/**
 * Decompression des archives deposees dans le dossier Import.
 *
 * Les ROMs circulent presque toujours en .zip : sans cette etape, chaque
 * ajout demanderait une decompression manuelle prealable.
 *
 * L'extraction se fait en flux : un ISO de 4 Go enferme dans une archive ne
 * doit jamais transiter par la memoire.
 *
 * Securite — « zip slip » : le nom des entrees d'une archive est controle par
 * celui qui l'a fabriquee. Une entree nommee `../../../.bashrc` ecrirait hors
 * du dossier de destination. Chaque chemin est donc resolu puis verifie comme
 * etant bien a l'interieur avant la moindre ecriture.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import yauzl from 'yauzl';
import { config } from './config.js';

const openZip = promisify(yauzl.open);

/**
 * Outil externe capable de lire les formats que yauzl ne connait pas (.7z).
 *
 * Windows livre `tar.exe`, qui est bsdtar/libarchive et sait extraire du 7z
 * sans qu'aucun logiciel supplementaire soit installe. Sous Linux, bsdtar
 * joue le meme role quand il est present.
 */
const SEVENZIP_CANDIDATES = [
  '/mnt/c/Windows/System32/tar.exe',
  'C:\\Windows\\System32\\tar.exe',
  'bsdtar',
  '7z',
  '7za',
];

let cachedTool;

export function archiveTool() {
  if (cachedTool !== undefined) return cachedTool;
  cachedTool = null;
  for (const bin of SEVENZIP_CANDIDATES) {
    try {
      const probe = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 8000 });
      if (probe.status === 0 || probe.status === 1) { cachedTool = bin; break; }
    } catch { /* candidat suivant */ }
  }
  return cachedTool;
}

/** Sous WSL, un binaire Windows attend un chemin Windows. */
const IS_WSL = process.platform === 'linux' && /microsoft/i.test(os.release());

function toolPath(p, tool) {
  if (!IS_WSL || !/\.exe$/i.test(tool)) return p;
  const m = /^\/mnt\/([a-z])\/(.*)$/i.exec(p);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p;
}

/** Extrait une archive non-zip via l'outil systeme. */
function extractWithTool(archivePath, dir) {
  const tool = archiveTool();
  if (!tool) {
    const err = new Error('Aucun outil disponible pour ce format (.7z)');
    err.code = 'NO_TOOL';
    throw err;
  }
  fs.mkdirSync(dir, { recursive: true });
  const is7zBinary = /(^|\/)7za?$/.test(tool);
  const args = is7zBinary
    ? ['x', toolPath(archivePath, tool), `-o${toolPath(dir, tool)}`, '-y']
    : ['-xf', toolPath(archivePath, tool), '-C', toolPath(dir, tool)];

  execFileSync(tool, args, { stdio: 'ignore', timeout: 30 * 60 * 1000 });

  const files = [];
  let bytes = 0;
  const walkOut = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walkOut(full);
      else { files.push(full); bytes += fs.statSync(full).size; }
    }
  };
  walkOut(dir);
  return { dir, files, skipped: [], bytes };
}

/** Taille au-dela de laquelle on prefere prevenir plutot que decompresser. */
const BIG_ARCHIVE = 8 * 1024 * 1024 * 1024; // 8 Go

/** Fichiers parasites qu'on ne recopie pas. */
const JUNK = /^(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

/**
 * Nettoie le nom d'une entree d'archive et verifie qu'il reste confine.
 * @returns {string|null} chemin absolu sur, ou null si l'entree est refusee
 */
function safeTarget(root, entryName) {
  // On neutralise les separateurs Windows et les chemins absolus
  const cleaned = entryName.replace(/\\/g, '/').replace(/^(\/|[a-zA-Z]:\/)+/, '');
  if (!cleaned || JUNK.test(cleaned)) return null;

  const target = path.resolve(root, cleaned);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

/** Contenu d'une archive, sans rien extraire. */
export async function inspect(archivePath) {
  const zip = await openZip(archivePath, { lazyEntries: true, autoClose: true });
  const entries = [];
  let total = 0;

  await new Promise((resolve, reject) => {
    zip.on('entry', (entry) => {
      if (!entry.fileName.endsWith('/')) {
        entries.push({ name: entry.fileName, size: entry.uncompressedSize });
        total += entry.uncompressedSize;
      }
      zip.readEntry();
    });
    zip.on('end', resolve);
    zip.on('error', reject);
    zip.readEntry();
  });

  return { entries, total, count: entries.length };
}

/**
 * Extrait une archive dans un dossier voisin portant son nom.
 * @returns {{dir: string, files: string[], skipped: string[], bytes: number}}
 */
export async function extract(archivePath, { force = false } = {}) {
  const stat = fs.statSync(archivePath);
  if (!force && stat.size > BIG_ARCHIVE) {
    const err = new Error(
      `Archive de ${(stat.size / 1073741824).toFixed(1)} Go — extraction à confirmer`,
    );
    err.code = 'TOO_BIG';
    throw err;
  }

  /*
   * Le contenu part dans le dossier Import, jamais a cote de l'archive.
   *
   * Deux raisons. D'abord l'espace : scanner un dossier de telechargements
   * y laissait la version decompressee pour toujours — 7,7 Go de residus
   * constates. Ensuite le rangement : `accept()` ne deplace un fichier vers
   * la bibliotheque que s'il vient d'Import ; extrait ailleurs, un jeu
   * restait reference dans le dossier d'origine, qu'on ne pouvait plus vider
   * sans casser sa fiche.
   */
  const base = path.basename(archivePath, path.extname(archivePath));
  const dir = path.join(config.importPath, '_extraction', base);
  fs.mkdirSync(dir, { recursive: true });

  // Les formats que yauzl ne lit pas passent par l'outil systeme
  if (path.extname(archivePath).toLowerCase() !== '.zip') {
    return extractWithTool(archivePath, dir);
  }

  const zip = await openZip(archivePath, { lazyEntries: true, autoClose: true });
  const files = [];
  const skipped = [];
  let bytes = 0;

  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);

    zip.on('entry', (entry) => {
      const target = safeTarget(dir, entry.fileName);
      if (!target) {
        // Entree refusee : hors du dossier, ou fichier parasite
        if (!JUNK.test(entry.fileName.replace(/\\/g, '/'))) skipped.push(entry.fileName);
        zip.readEntry();
        return;
      }

      if (entry.fileName.endsWith('/')) {
        fs.mkdirSync(target, { recursive: true });
        zip.readEntry();
        return;
      }

      zip.openReadStream(entry, async (err, stream) => {
        if (err) { reject(err); return; }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          await pipeline(stream, fs.createWriteStream(target));
          files.push(target);
          bytes += entry.uncompressedSize;
        } catch (e) {
          reject(e);
          return;
        }
        zip.readEntry();
      });
    });

    zip.readEntry();
  });

  return { dir, files, skipped, bytes };
}

/**
 * Si l'archive ne contenait qu'un dossier racine, on le remonte d'un cran :
 * evite `Import/Jeu/Jeu/jeu.iso`.
 */
export function flatten(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'));
    if (entries.length !== 1 || !entries[0].isDirectory()) return dir;

    const inner = path.join(dir, entries[0].name);
    for (const name of fs.readdirSync(inner)) {
      fs.renameSync(path.join(inner, name), path.join(dir, name));
    }
    fs.rmdirSync(inner);
  } catch { /* structure inattendue : on laisse tel quel */ }
  return dir;
}

export { BIG_ARCHIVE };
