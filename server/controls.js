/**
 * Profils de commandes, par console.
 *
 * EmulatorJS range ses reglages dans le localStorage du navigateur, et par
 * *jeu* : il faudrait donc tout remapper a chaque titre, et rien ne suivrait
 * d'un appareil a l'autre. Dimstorted stocke donc les profils cote serveur,
 * une fois par console, et les injecte au chargement du lecteur.
 *
 * Avertissement verifie a l'usage : un objet de commandes incomplet fait
 * planter EmulatorJS (« Cannot read properties of undefined »). Il exige les
 * quatre joueurs declares. Toute sortie de ce module passe donc par
 * `normalize()`, qui garantit la structure quoi qu'il arrive.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { CONSOLES } from './consoles.js';

const FILE = path.join(config.dataPath, 'controls.json');

/** Indices libretro des boutons (RETRO_DEVICE_ID_JOYPAD). */
export const BUTTONS = {
  0: 'B', 1: 'Y', 2: 'SELECT', 3: 'START',
  4: 'UP', 5: 'DOWN', 6: 'LEFT', 7: 'RIGHT',
  8: 'A', 9: 'X', 10: 'L', 11: 'R',
  12: 'L2', 13: 'R2', 14: 'L3', 15: 'R3',
};

/**
 * Noms affiches selon la console : la touche libretro « B » est le bouton A
 * sur NES, le bouton Croix sur PlayStation, le bouton A sur Mega Drive.
 * Afficher « B » partout serait incomprehensible.
 */
const LABELS = {
  nintendo: { 0: 'B', 8: 'A', 9: 'X', 1: 'Y', 10: 'L', 11: 'R' },
  nes:      { 0: 'B', 8: 'A' },
  sega:     { 0: 'A', 8: 'B', 9: 'C', 1: 'X', 10: 'Y', 11: 'Z' },
  sony:     { 0: 'Croix', 8: 'Rond', 9: 'Triangle', 1: 'Carré',
              10: 'L1', 11: 'R1', 12: 'L2', 13: 'R2', 14: 'L3', 15: 'R3' },
};

/** Les directions se disent en francais ; SELECT et START sont gravés
 *  tels quels sur les consoles, on les laisse. */
const DIRECTION_LABELS = { 4: 'Haut', 5: 'Bas', 6: 'Gauche', 7: 'Droite' };

const FAMILY = {
  nes: 'nes', snes: 'nintendo', n64: 'nintendo', gb: 'nintendo', gba: 'nintendo',
  gamecube: 'nintendo',
  segaMD: 'sega', segaMS: 'sega', segaGG: 'sega', sg1000: 'sega', segaCD: 'sega',
  dreamcast: 'sega',
  psx: 'sony', ps2: 'sony', psp: 'sony',
};

/** Boutons reellement presents sur chaque console : inutile d'en proposer plus. */
const AVAILABLE = {
  nes: [4, 5, 6, 7, 0, 8, 2, 3],
  sg1000: [4, 5, 6, 7, 0, 8, 3],
  segaMS: [4, 5, 6, 7, 0, 8, 3],
  segaGG: [4, 5, 6, 7, 0, 8, 3],
  segaMD: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 3, 2],
  segaCD: [4, 5, 6, 7, 0, 8, 9, 3, 2],
  gb: [4, 5, 6, 7, 0, 8, 2, 3],
  gba: [4, 5, 6, 7, 0, 8, 10, 11, 2, 3],
  snes: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 2, 3],
  n64: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 12, 3],
  psx: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 12, 13, 2, 3],
  ps2: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 12, 13, 14, 15, 2, 3],
  psp: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 3, 2],
  dreamcast: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 3],
  gamecube: [4, 5, 6, 7, 0, 8, 9, 1, 10, 11, 3],
};

/**
 * Reglage par defaut, pense pour un clavier AZERTY.
 * ZQSD pour la direction, la main droite sur les actions.
 */
const DEFAULT_PLAYER_1 = {
  4:  { value: 90, value2: 'DPAD_UP' },       // Z
  5:  { value: 83, value2: 'DPAD_DOWN' },     // S
  6:  { value: 81, value2: 'DPAD_LEFT' },     // Q
  7:  { value: 68, value2: 'DPAD_RIGHT' },    // D
  0:  { value: 75, value2: 'BUTTON_2' },      // K
  8:  { value: 76, value2: 'BUTTON_1' },      // L
  9:  { value: 73, value2: 'BUTTON_4' },      // I
  1:  { value: 79, value2: 'BUTTON_3' },      // O
  10: { value: 65, value2: 'LEFT_TOP_SHOULDER' },   // A
  11: { value: 69, value2: 'RIGHT_TOP_SHOULDER' },  // E
  12: { value: 87, value2: 'LEFT_BOTTOM_SHOULDER' },  // W
  13: { value: 88, value2: 'RIGHT_BOTTOM_SHOULDER' }, // X
  14: { value: 67, value2: 'LEFT_STICK' },    // C
  15: { value: 86, value2: 'RIGHT_STICK' },   // V
  2:  { value: 16, value2: 'SELECT' },        // Maj
  3:  { value: 13, value2: 'START' },         // Entrée
};

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(all, null, 2)}\n`);
}

/**
 * Garantit une structure qu'EmulatorJS acceptera : quatre joueurs, des
 * indices de boutons valides, des valeurs numeriques. C'est le garde-fou
 * qui evite l'ecran noir constate lors des essais.
 */
export function normalize(profile) {
  const out = { 0: {}, 1: {}, 2: {}, 3: {} };
  if (!profile || typeof profile !== 'object') return out;

  for (const player of [0, 1, 2, 3]) {
    const src = profile[player] ?? profile[String(player)];
    if (!src || typeof src !== 'object') continue;
    for (const [key, binding] of Object.entries(src)) {
      const index = Number(key);
      if (!Number.isInteger(index) || !(index in BUTTONS)) continue;
      if (!binding || typeof binding !== 'object') continue;

      const entry = {};
      const value = Number(binding.value);
      if (Number.isFinite(value) && value >= 0 && value <= 255) entry.value = value;
      if (typeof binding.value2 === 'string' && /^[A-Z0-9_]{1,32}$/.test(binding.value2)) {
        entry.value2 = binding.value2;
      }
      if (Object.keys(entry).length) out[player][index] = entry;
    }
  }
  return out;
}

/** Profil par defaut d'une console, limite a ses boutons reels. */
export function defaultProfile(consoleId) {
  const available = AVAILABLE[consoleId] || Object.keys(BUTTONS).map(Number);
  const player1 = {};
  for (const index of available) {
    if (DEFAULT_PLAYER_1[index]) player1[index] = { ...DEFAULT_PLAYER_1[index] };
  }
  return { 0: player1, 1: {}, 2: {}, 3: {} };
}

/**
 * Remet l'affectation manette d'origine sur les boutons qui n'en ont plus.
 *
 * L'interface de configuration ne capture que des touches de clavier : il n'y
 * a aucun moyen d'enlever volontairement une affectation de manette. Quand il
 * en manque une, c'est un profil ecrit avant qu'elles existent — le profil NES
 * l'etait, et la manette y restait muette alors qu'elle marchait ailleurs.
 *
 * On ne touche jamais au clavier : ce que la personne a choisi reste.
 */
function completerManette(profil, consoleId) {
  for (const [index, binding] of Object.entries(profil[0])) {
    if (binding.value2) continue;
    const defaut = DEFAULT_PLAYER_1[Number(index)];
    if (defaut?.value2) binding.value2 = defaut.value2;
  }
  return profil;
}

export function get(consoleId) {
  const stored = load()[consoleId];
  return stored ? completerManette(normalize(stored), consoleId) : defaultProfile(consoleId);
}

export function set(consoleId, profile) {
  if (!CONSOLES[consoleId]) throw new Error(`Console inconnue : ${consoleId}`);
  const clean = normalize(profile);
  if (!Object.keys(clean[0]).length) {
    throw new Error('Le profil ne contient aucune touche pour le joueur 1');
  }
  const all = load();
  all[consoleId] = clean;
  save(all);
  return clean;
}

export function reset(consoleId) {
  const all = load();
  delete all[consoleId];
  save(all);
  return defaultProfile(consoleId);
}

/** Description destinee a l'interface de configuration. */
export function layout(consoleId) {
  const family = FAMILY[consoleId] || 'nintendo';
  const labels = { ...LABELS[family] };
  if (family === 'nes') Object.assign(labels, LABELS.nes);

  const available = AVAILABLE[consoleId] || Object.keys(BUTTONS).map(Number);
  return available.map((index) => ({
    index,
    code: BUTTONS[index],
    label: DIRECTION_LABELS[index] || labels[index] || BUTTONS[index],
    direction: index >= 4 && index <= 7,
  }));
}

export function isCustomized(consoleId) {
  return Object.hasOwn(load(), consoleId);
}
