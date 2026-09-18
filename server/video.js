/**
 * Reglages d'image par console : shader et mise a l'echelle.
 *
 * Comme pour les commandes, EmulatorJS garde ses reglages dans le
 * localStorage du navigateur et par jeu. On les stocke donc cote serveur,
 * une fois par console, pour qu'ils valent partout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { CONSOLES, videoFor } from './consoles.js';

const FILE = path.join(config.dataPath, 'video.json');

/**
 * Shaders livres avec EmulatorJS, regroupes par intention.
 * Les `crt-*` reproduisent une television cathodique ; les `*ScaleHQ` et
 * `sabr` lissent les contours sans imiter d'ecran.
 */
export const SHADERS = [
  { id: 'disabled',           name: 'Aucun',              group: 'Direct' },
  { id: 'crt-geom.glslp',     name: 'CRT — Geom',         group: 'Télé cathodique' },
  { id: 'crt-aperture.glslp', name: 'CRT — Aperture',     group: 'Télé cathodique' },
  { id: 'crt-easymode.glslp', name: 'CRT — Easymode',     group: 'Télé cathodique' },
  { id: 'crt-mattias.glslp',  name: 'CRT — Mattias',      group: 'Télé cathodique' },
  { id: 'crt-lottes',         name: 'CRT — Lottes',       group: 'Télé cathodique' },
  { id: 'crt-beam',           name: 'CRT — Beam',         group: 'Télé cathodique' },
  { id: 'crt-caligari',       name: 'CRT — Caligari',     group: 'Télé cathodique' },
  { id: 'crt-zfast',          name: 'CRT — Zfast (léger)', group: 'Télé cathodique' },
  { id: '2xScaleHQ.glslp',    name: 'ScaleHQ 2×',         group: 'Lissage' },
  { id: '4xScaleHQ.glslp',    name: 'ScaleHQ 4×',         group: 'Lissage' },
  { id: 'sabr',               name: 'SABR',               group: 'Lissage' },
  { id: 'bicubic',            name: 'Bicubique',          group: 'Lissage' },
];

const VALID = new Set(SHADERS.map((s) => s.id));

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

/** Reglages effectifs : les defauts du code, ecrases par le choix stocke. */
export function get(consoleId) {
  const base = videoFor(consoleId);
  const stored = load()[consoleId] || {};
  return {
    pixelated: typeof stored.pixelated === 'boolean' ? stored.pixelated : Boolean(base.pixelated),
    shader: VALID.has(stored.shader) ? stored.shader : 'disabled',
    coreOptions: base.coreOptions || null,
    customized: Object.keys(stored).length > 0,
  };
}

export function set(consoleId, patch) {
  if (!CONSOLES[consoleId]) throw new Error(`Console inconnue : ${consoleId}`);

  const all = load();
  const entry = { ...(all[consoleId] || {}) };

  if (patch.shader !== undefined) {
    if (!VALID.has(patch.shader)) throw new Error(`Shader inconnu : ${patch.shader}`);
    entry.shader = patch.shader;
  }
  if (patch.pixelated !== undefined) entry.pixelated = Boolean(patch.pixelated);

  all[consoleId] = entry;
  save(all);
  return get(consoleId);
}

export function reset(consoleId) {
  const all = load();
  delete all[consoleId];
  save(all);
  return get(consoleId);
}
