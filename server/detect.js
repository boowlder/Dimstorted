/**
 * Detection de la console a partir d'un fichier.
 *
 * Strategie en cascade :
 *   1. Extension non ambigue  -> certitude totale
 *   2. Extension ambigue      -> lecture de l'en-tete binaire du fichier
 *   3. Echec                  -> renvoie confidence "low", l'ecran de
 *                                validation demandera l'arbitrage a l'humain
 *
 * Aucune detection n'est jamais imposee : le resultat porte toujours un
 * niveau de confiance et une explication lisible.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EXT_MAP, ARCHIVE_EXT } from './consoles.js';

// Signatures binaires des disques Nintendo (offset -> valeur attendue)
const GAMECUBE_MAGIC = 0xc2339f3d; // offset 0x1C
const WII_MAGIC = 0x5d1c9ea3; // offset 0x18

const MB = 1024 * 1024;

/** Lit `length` octets a partir de `offset` sans charger tout le fichier. */
function readChunk(filePath, offset, length) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, offset);
    return read > 0 ? buf.subarray(0, read) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * Cherche une chaine ASCII dans les `maxBytes` premiers octets du fichier.
 * Lit par blocs avec chevauchement pour ne pas rater une occurrence a cheval.
 */
function findString(filePath, needle, maxBytes = 32 * MB) {
  const target = Buffer.from(needle, 'ascii');
  const CHUNK = 4 * MB;
  const overlap = target.length - 1;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const limit = Math.min(size, maxBytes);
    const buf = Buffer.alloc(CHUNK + overlap);
    let offset = 0;
    let carry = 0;

    while (offset < limit) {
      const toRead = Math.min(CHUNK, limit - offset);
      const read = fs.readSync(fd, buf, carry, toRead, offset);
      if (read <= 0) break;
      const view = buf.subarray(0, carry + read);
      if (view.includes(target)) return true;
      // On conserve la fin du bloc pour couvrir les occurrences a cheval
      carry = Math.min(overlap, view.length);
      view.subarray(view.length - carry).copy(buf, 0);
      offset += read;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * Analyse un .iso : GameCube/Wii par signature, puis PSP/PS2/PS1 par
 * recherche des marqueurs de demarrage dans la zone systeme.
 */
function sniffIso(filePath) {
  const head = readChunk(filePath, 0, 0x20);
  if (head && head.length >= 0x20) {
    if (head.readUInt32BE(0x1c) === GAMECUBE_MAGIC) {
      return { console: 'gamecube', confidence: 'high', reason: 'Signature disque GameCube' };
    }
    if (head.readUInt32BE(0x18) === WII_MAGIC) {
      return { console: null, confidence: 'high', reason: 'Disque Wii detecte (console non geree)' };
    }
  }

  // UMD PSP : l'arborescence contient toujours PSP_GAME
  if (findString(filePath, 'PSP_GAME', 8 * MB)) {
    return { console: 'psp', confidence: 'high', reason: 'Arborescence PSP_GAME trouvee' };
  }

  // SYSTEM.CNF : "BOOT2" est propre a la PS2, "BOOT" seul a la PS1
  if (findString(filePath, 'BOOT2', 32 * MB)) {
    return { console: 'ps2', confidence: 'high', reason: 'SYSTEM.CNF contient BOOT2 (PS2)' };
  }
  if (findString(filePath, 'PLAYSTATION', 1 * MB)) {
    return { console: 'psx', confidence: 'medium', reason: 'Zone systeme PlayStation, sans BOOT2 (PS1)' };
  }

  const size = safeSize(filePath);
  if (size > 900 * MB) {
    return { console: 'ps2', confidence: 'low', reason: `Taille DVD (${fmt(size)}), PS2 probable` };
  }
  return { console: null, confidence: 'low', reason: 'ISO non identifie' };
}

/**
 * Analyse un .chd. Le format compresse ne permet pas de lire le contenu
 * directement, mais son en-tete et ses metadonnees suffisent a distinguer
 * un CD (pistes CHTR/CHT2) d'un DVD (pas de pistes, grande taille).
 */
function sniffChd(filePath) {
  const head = readChunk(filePath, 0, 64);
  if (!head || head.subarray(0, 8).toString('ascii') !== 'MComprHD') {
    return { console: null, confidence: 'low', reason: 'Fichier CHD invalide' };
  }

  const version = head.readUInt32BE(12);
  // logicalbytes se trouve a l'offset 32 en v5, 28 en v3/v4
  const logicalOffset = version >= 5 ? 32 : 28;
  let logicalBytes = 0;
  const lb = readChunk(filePath, logicalOffset, 8);
  if (lb && lb.length === 8) logicalBytes = Number(lb.readBigUInt64BE(0));

  const piste = premierePiste(filePath, head, version);
  const isCd = piste.trouve;

  /*
   * Un CD ne depasse pas ~870 Mo de donnees. Au-dela, c'est un DVD — meme
   * si les metadonnees annoncent des pistes CD.
   *
   * Le cas n'a rien de theorique : le pack PS2 d'Arquivista encode ses DVD
   * au format CD (metadonnees CHT2, unite de 2448 octets). God of War y
   * pesait 9,58 Go de donnees et etait pourtant classe « PS1 probable ».
   * Sans ce garde-fou, 41 jeux PS2 sur 45 partaient sur le mauvais
   * emulateur, en silence.
   */
  if (logicalBytes > 900 * MB) {
    if (logicalBytes < 1.5 * 1024 * MB) {
      return { console: 'ps2', confidence: 'medium', reason: `DVD de ${fmt(logicalBytes)} - PS2 probable (GameCube possible)` };
    }
    return { console: 'ps2', confidence: 'high', reason: `DVD de ${fmt(logicalBytes)} - trop gros pour un CD` };
  }

  // Une piste MODE1 signe un DVD : les disques PS1 sont en MODE2 brut.
  if (piste.type === 'MODE1') {
    return { console: 'ps2', confidence: 'medium', reason: `Piste MODE1 (${fmt(logicalBytes)}) - disque de type DVD` };
  }

  if (isCd) {
    // Taille de CD et piste MODE2 : PS1 le plus souvent, mais certains jeux
    // PS2 sont sortis sur CD (Crazy Taxi, Half-Life). Rien dans l'en-tete ne
    // les distingue — c'est le dossier qui tranchera, sinon l'utilisateur.
    if (logicalBytes > 0) {
      return { console: 'psx', confidence: 'medium', reason: `CHD avec pistes CD (${fmt(logicalBytes)}) - PS1 probable` };
    }
    return { console: 'psx', confidence: 'low', reason: 'CHD avec pistes CD, console a confirmer' };
  }

  if (logicalBytes > 1.2 * 1024 * MB) {
    return { console: 'gamecube', confidence: 'low', reason: `CHD DVD ${fmt(logicalBytes)} - GameCube ou PS2` };
  }
  if (logicalBytes > 900 * MB) {
    return { console: 'ps2', confidence: 'low', reason: `CHD DVD ${fmt(logicalBytes)} - PS2 probable` };
  }
  return { console: 'psx', confidence: 'low', reason: 'CHD de taille CD, console a confirmer' };
}

/**
 * Parcourt la liste chainee de metadonnees du CHD.
 * @returns {{trouve: boolean, type: string|null}} presence de pistes CD et
 *          type de la premiere (MODE1, MODE2_RAW, AUDIO...)
 */
function premierePiste(filePath, head, version) {
  try {
    const metaOffset = version >= 5 ? 48 : 36;
    const mo = readChunk(filePath, metaOffset, 8);
    if (!mo || mo.length !== 8) return { trouve: false, type: null };
    let next = Number(mo.readBigUInt64BE(0));

    // On borne le parcours : un CHD sain a peu d'entrees de metadonnees
    for (let i = 0; next > 0 && i < 128; i++) {
      const entry = readChunk(filePath, next, 16);
      if (!entry || entry.length < 16) return { trouve: false, type: null };
      const tag = entry.subarray(0, 4).toString('ascii');
      if (tag === 'CHTR' || tag === 'CHT2' || tag === 'CHGT') {
        const taille = entry.readUInt32BE(4) & 0xffffff;
        const texte = readChunk(filePath, next + 16, Math.min(taille, 120));
        const m = texte && texte.toString('ascii').match(/TYPE:(\w+)/);
        return { trouve: true, type: m ? m[1] : null };
      }
      next = Number(entry.readBigUInt64BE(8));
    }
  } catch { /* metadonnees illisibles : on retombe sur l'heuristique de taille */ }
  return { trouve: false, type: null };
}

/** Un .cue pointe vers une ou plusieurs pistes : on analyse la premiere. */
function sniffCue(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/FILE\s+"([^"]+)"/i) || content.match(/FILE\s+(\S+)/i);
    if (match) {
      const target = path.join(path.dirname(filePath), match[1]);
      if (fs.existsSync(target)) {
        const inner = sniffDataTrack(target);
        if (inner.console) return { ...inner, reason: `${inner.reason} (via .cue)` };
      }
    }
  } catch { /* cue illisible */ }
  return { console: 'psx', confidence: 'low', reason: 'Feuille .cue, PS1 par defaut' };
}

/** Analyse une piste de donnees brute (.bin/.img) issue d'un CD. */
function sniffDataTrack(filePath) {
  if (findString(filePath, 'PLAYSTATION', 2 * MB)) {
    if (findString(filePath, 'BOOT2', 16 * MB)) {
      return { console: 'ps2', confidence: 'high', reason: 'Piste de donnees PS2' };
    }
    return { console: 'psx', confidence: 'high', reason: 'Piste de donnees PS1' };
  }
  if (findString(filePath, 'SEGADISCSYSTEM', 1 * MB) || findString(filePath, 'SEGABOOTDISC', 1 * MB)) {
    return { console: 'segaCD', confidence: 'high', reason: 'En-tete Sega Mega-CD' };
  }
  if (findString(filePath, 'SEGA SEGAKATANA', 1 * MB)) {
    return { console: 'dreamcast', confidence: 'high', reason: 'En-tete Dreamcast' };
  }
  return { console: null, confidence: 'low', reason: 'Piste de donnees non identifiee' };
}

/**
 * En-tete interne d'une cartouche Super Nintendo.
 *
 * Elle est posee a un endroit qui depend du decoupage memoire — 0x7FC0 en
 * LoROM, 0xFFC0 en HiROM, 0x40FFC0 en ExHiROM — et tout le bloc glisse de
 * 512 octets quand le dump porte encore l'en-tete d'un copieur d'epoque.
 *
 * On ne se fie pas au titre, qui peut etre n'importe quoi : les deux derniers
 * champs sont une somme de controle et son complement, dont le OU exclusif
 * vaut 0xFFFF. Deux octets tires au hasard ne satisfont cette egalite qu'une
 * fois sur 65 536.
 */
function enTeteSnes(filePath) {
  for (const decalage of [0, 0x200]) {
    for (const base of [0x7FC0, 0xFFC0, 0x40FFC0]) {
      const buf = readChunk(filePath, base + decalage, 32);
      if (!buf || buf.length < 32) continue;
      const complement = buf.readUInt16LE(0x1C);
      const somme = buf.readUInt16LE(0x1E);
      if (somme === 0 && complement === 0) continue;   // zone vierge
      if ((complement ^ somme) !== 0xFFFF) continue;
      return true;
    }
  }
  return false;
}

/**
 * Un .bin isole est ambigu : piste de CD, cartouche Mega Drive ou Super
 * Nintendo. Les dumps TOSEC de SNES sortent justement en .bin, et une
 * decision prise sur la seule taille les envoyait tous chez Sega.
 */
function sniffBin(filePath) {
  const cuePath = filePath.replace(/\.bin$/i, '.cue');
  if (fs.existsSync(cuePath)) {
    return { console: null, confidence: 'skip', reason: 'Piste rattachee a un .cue' };
  }
  const size = safeSize(filePath);
  if (size > 0 && size <= 16 * MB) {
    // Le nom de la console est ecrit en clair dans l'en-tete Mega Drive
    const sega = readChunk(filePath, 0x100, 16);
    if (sega && /SEGA (MEGA DRIVE|GENESIS)/i.test(sega.toString('latin1'))) {
      return { console: 'segaMD', confidence: 'high', reason: 'En-tete Mega Drive' };
    }
    if (enTeteSnes(filePath)) {
      return { console: 'snes', confidence: 'high', reason: 'En-tete Super Nintendo' };
    }
    return { console: 'segaMD', confidence: 'medium', reason: `Cartouche de ${fmt(size)} - Mega Drive probable` };
  }
  const track = sniffDataTrack(filePath);
  if (track.console) return track;
  return { console: null, confidence: 'low', reason: 'Fichier .bin non identifie' };
}

/** Un .m3u liste les disques d'un jeu multi-CD : on analyse le premier. */
function sniffM3u(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (lines.length) {
      const target = path.join(path.dirname(filePath), lines[0]);
      if (fs.existsSync(target)) {
        const inner = detectConsole(target);
        return { ...inner, reason: `${inner.reason} (via .m3u)` };
      }
    }
  } catch { /* m3u illisible */ }
  return { console: 'psx', confidence: 'low', reason: 'Liste .m3u, PS1 par defaut' };
}

function safeSize(filePath) {
  try { return fs.statSync(filePath).size; } catch { return 0; }
}

function fmt(bytes) {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} Go`;
  return `${Math.round(bytes / MB)} Mo`;
}

/**
 * Point d'entree : identifie la console d'un fichier.
 * @returns {{console: string|null, confidence: 'high'|'medium'|'low'|'skip', reason: string}}
 */
/**
 * Consoles reconnaissables au nom d'un dossier.
 *
 * Certains disques sont indiscernables par leur en-tete : Crazy Taxi et
 * Half-Life sont des jeux PS2 sortis sur CD, strictement identiques a un CD
 * PS1 du point de vue du format. Mais quand ils vivent dans un dossier
 * nomme « PS2 », le doute n'est plus permis.
 */
const DOSSIER_CONSOLE = {
  ps1: 'psx', psx: 'psx', playstation: 'psx', psone: 'psx',
  ps2: 'ps2', playstation2: 'ps2',
  psp: 'psp',
  gamecube: 'gamecube', gc: 'gamecube', ngc: 'gamecube',
  dreamcast: 'dreamcast', dc: 'dreamcast',
  megacd: 'segaCD', segacd: 'segaCD', segacd32x: 'segaCD', megacd32x: 'segaCD',
  megadrive: 'segaMD', genesis: 'segaMD', segamd: 'segaMD',
  mastersystem: 'segaMS', segams: 'segaMS', sms: 'segaMS',
  gamegear: 'segaGG', segagg: 'segaGG',
  sg1000: 'sg1000',
  nes: 'nes', snes: 'snes', supernintendo: 'snes',
  n64: 'n64', nintendo64: 'n64',
  gameboy: 'gb', gb: 'gb', gbc: 'gb',
  gba: 'gba', gameboyadvance: 'gba',
};

/** Console suggeree par l'un des dossiers parents, s'il y en a une. */
function indiceDossier(filePath) {
  for (const partie of path.dirname(filePath).split(/[\\/]/).reverse()) {
    const cle = partie.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (DOSSIER_CONSOLE[cle]) return DOSSIER_CONSOLE[cle];
  }
  return null;
}

export function detectConsole(filePath) {
  const brut = detecter(filePath);

  /*
   * Le dossier ne sert qu'a lever un doute, jamais a contredire une
   * detection sure : un fichier .nes range par erreur dans « PS2 » reste
   * une ROM NES.
   */
  if (brut.confidence === 'high' || brut.confidence === 'skip') return brut;

  const indice = indiceDossier(filePath);
  if (indice && indice !== brut.console) {
    return {
      console: indice,
      confidence: 'medium',
      reason: `${brut.reason} — corrige d'apres le dossier`,
    };
  }
  if (indice) {
    return { ...brut, confidence: 'high', reason: `${brut.reason} — confirme par le dossier` };
  }
  return brut;
}

function detecter(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ARCHIVE_EXT.includes(ext)) {
    return { console: null, confidence: 'skip', reason: 'Archive a decompresser' };
  }

  if (EXT_MAP[ext]) {
    return {
      console: EXT_MAP[ext],
      confidence: 'high',
      reason: `Extension ${ext} propre a cette console`,
    };
  }

  switch (ext) {
    case '.iso': return sniffIso(filePath);
    case '.chd': return sniffChd(filePath);
    case '.cue': return sniffCue(filePath);
    case '.bin': return sniffBin(filePath);
    case '.img': return sniffDataTrack(filePath);
    case '.m3u': return sniffM3u(filePath);
    default:
      return { console: null, confidence: 'low', reason: `Extension ${ext} inconnue` };
  }
}

export const _internals = { findString, readChunk, sniffDataTrack };
