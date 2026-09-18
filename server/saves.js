/**
 * Sauvegardes d'etat.
 *
 * C'est la fonction qui rend Dimstorted plus commode qu'une vraie console :
 * on ferme l'onglet au milieu d'un niveau, on revient trois semaines plus
 * tard, et on reprend exactement au meme endroit.
 *
 * Deux natures de sauvegarde :
 *   slot 0    automatique — ecrite a chaque sortie, c'est elle qui alimente
 *             la rangee « Reprendre la partie »
 *   slots 1-9 manuelles — declenchees par l'utilisateur, jamais ecrasees
 *             automatiquement
 *
 * Les fichiers vivent sur le SSD a cote de la base, pas sur le disque des
 * jeux : ils sont petits, lus et ecrits souvent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { stmt } from './db.js';
import * as profiles from './profiles.js';

const SAVES_DIR = path.join(config.dataPath, 'saves');

export const AUTO_SLOT = 0;
export const MAX_SLOT = 9;

/**
 * Chaque profil a ses propres fichiers : `saves/p2/game-7/slot-0.state`.
 * Un invite ne peut donc pas ecraser une partie, meme en visant le meme
 * emplacement du meme jeu.
 */
function gameDir(gameId, profileId) {
  return profiles.savesDir(profileId, gameId);
}

function statePath(gameId, slot, profileId) {
  return path.join(gameDir(gameId, profileId), `slot-${slot}.state`);
}

function shotPath(gameId, slot, profileId) {
  return path.join(gameDir(gameId, profileId), `slot-${slot}.png`);
}

export function validSlot(slot) {
  const n = Number(slot);
  return Number.isInteger(n) && n >= AUTO_SLOT && n <= MAX_SLOT;
}

/**
 * Enregistre un etat.
 * @param {number} gameId
 * @param {number} slot
 * @param {Buffer} state  octets de l'etat, tels que fournis par l'emulateur
 * @param {Buffer|null} shot  capture PNG facultative
 */
export function write(gameId, slot, state, shot = null, label = null) {
  if (!state || !state.length) throw new Error('État de sauvegarde vide');

  const profileId = profiles.currentId();
  if (profileId == null) throw new Error('Aucun profil actif');

  fs.mkdirSync(gameDir(gameId, profileId), { recursive: true });
  fs.writeFileSync(statePath(gameId, slot, profileId), state);

  let shotUrl = null;
  if (shot && shot.length > 64) {
    fs.writeFileSync(shotPath(gameId, slot, profileId), shot);
    // Horodatage dans l'URL : sans lui le navigateur reafficherait
    // l'ancienne capture depuis son cache apres chaque sauvegarde
    shotUrl = `/saves/p${profileId}/game-${gameId}/slot-${slot}.png?v=${Date.now()}`;
  }

  stmt.upsertSave.run({
    profile_id: profileId,
    game_id: gameId,
    slot,
    size: state.length,
    shot: shotUrl,
    label,
    created_at: Date.now(),
  });

  return read(gameId, slot);
}

export function read(gameId, slot) {
  return stmt.saveBySlot.get(profiles.currentId(), gameId, slot) || null;
}

export function list(gameId) {
  return stmt.savesByGame.all(profiles.currentId(), gameId);
}

export function statePathFor(gameId, slot) {
  const p = statePath(gameId, slot, profiles.currentId());
  return fs.existsSync(p) ? p : null;
}

export function remove(gameId, slot) {
  const profileId = profiles.currentId();
  for (const p of [statePath(gameId, slot, profileId), shotPath(gameId, slot, profileId)]) {
    try { fs.unlinkSync(p); } catch { /* deja absent */ }
  }
  stmt.deleteSave.run(profileId, gameId, slot);
}

/**
 * Efface les sauvegardes d'un jeu pour TOUS les profils : on ne supprime une
 * fiche qu'en supprimant le jeu lui-meme, laisser trainer les parties des
 * autres n'aurait aucun sens.
 */
export function removeAll(gameId) {
  for (const p of profiles.list()) {
    try {
      fs.rmSync(gameDir(gameId, p.id), { recursive: true, force: true });
    } catch { /* rien a supprimer */ }
  }
  stmt.deleteSavesOfGame.run(gameId);
}

/** Identifiants des jeux reprenables par le profil actif, pour l'accueil. */
export function resumableIds() {
  const profileId = profiles.currentId();
  if (profileId == null) return new Set();
  return new Set(stmt.resumable.all(profileId).map((r) => r.game_id));
}

export { SAVES_DIR };
