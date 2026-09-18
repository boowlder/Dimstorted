/**
 * Catalogue des consoles supportees par Dimstorted.
 *
 * `runtime` decide de la facon dont un jeu se lance :
 *   - "web"    : joue dans le navigateur via EmulatorJS (coeur libretro en WASM)
 *   - "native" : necessite un emulateur installe sur le PC (PCSX2, Dolphin, Flycast)
 *
 * `ext` liste les extensions NON ambigues. Les extensions partagees entre
 * plusieurs consoles (.iso, .chd, .bin, .cue) sont resolues par detect.js,
 * qui lit l'en-tete du fichier.
 */

export const CONSOLES = {
  nes: {
    name: 'Nintendo NES',
    short: 'NES',
    runtime: 'web',
    core: 'nes',
    ext: ['.nes', '.unf', '.unif', '.fds'],
    bios: null,
  },
  snes: {
    name: 'Super Nintendo',
    short: 'SNES',
    runtime: 'web',
    core: 'snes',
    ext: ['.sfc', '.smc', '.swc', '.fig'],
    bios: null,
  },
  n64: {
    name: 'Nintendo 64',
    short: 'N64',
    runtime: 'web',
    core: 'n64',
    ext: ['.n64', '.z64', '.v64'],
    bios: null,
  },
  gb: {
    name: 'Game Boy / Color',
    short: 'Game Boy',
    runtime: 'web',
    core: 'gb',
    ext: ['.gb', '.gbc'],
    bios: null,
  },
  gba: {
    name: 'Game Boy Advance',
    short: 'GBA',
    runtime: 'web',
    core: 'gba',
    ext: ['.gba'],
    bios: null,
  },
  segaMD: {
    name: 'Sega Mega Drive',
    short: 'Mega Drive',
    runtime: 'web',
    core: 'segaMD',
    ext: ['.md', '.gen', '.smd', '.68k'],
    bios: null,
  },
  segaMS: {
    name: 'Sega Master System',
    short: 'Master System',
    runtime: 'web',
    core: 'segaMS',
    ext: ['.sms'],
    bios: null,
  },
  segaGG: {
    name: 'Sega Game Gear',
    short: 'Game Gear',
    runtime: 'web',
    core: 'segaGG',
    ext: ['.gg'],
    bios: null,
  },
  sg1000: {
    // Le coeur Master System de libretro (Genesis Plus GX) gere aussi la SG-1000.
    name: 'Sega SG-1000',
    short: 'SG-1000',
    runtime: 'web',
    core: 'segaMS',
    ext: ['.sg'],
    bios: null,
  },
  segaCD: {
    name: 'Sega Mega-CD',
    short: 'Mega-CD',
    runtime: 'web',
    core: 'segaCD',
    ext: [],
    bios: { required: true, files: ['bios_CD_E.bin', 'bios_CD_U.bin', 'bios_CD_J.bin'] },
  },
  psx: {
    name: 'Sony PlayStation',
    short: 'PS1',
    runtime: 'web',
    core: 'psx',
    ext: ['.pbp'],
    bios: { required: false, files: ['scph5500.bin', 'scph5501.bin', 'scph5502.bin'] },
  },
  psp: {
    name: 'Sony PSP',
    short: 'PSP',
    runtime: 'web',
    core: 'psp',
    ext: [],
    bios: null,
  },
  ps2: {
    name: 'Sony PlayStation 2',
    short: 'PS2',
    runtime: 'native',
    emulator: 'PCSX2',
    ext: ['.cso'],
    bios: { required: true, files: ['SCPH-xxxxx.bin'] },
  },
  gamecube: {
    name: 'Nintendo GameCube',
    short: 'GameCube',
    runtime: 'native',
    emulator: 'Dolphin',
    ext: ['.rvz', '.gcm', '.gcz'],
    bios: null,
  },
  dreamcast: {
    name: 'Sega Dreamcast',
    short: 'Dreamcast',
    runtime: 'native',
    emulator: 'Flycast',
    ext: ['.gdi', '.cdi'],
    bios: { required: true, files: ['dc_boot.bin', 'dc_flash.bin'] },
  },

  // --- Fangames et homebrew ---------------------------------------------
  // Un fangame n'est pas une ROM : c'est un jeu PC a part entiere. Il ne
  // passe donc pas par un coeur d'emulation. Deux cas se presentent selon
  // ce que l'auteur distribue : un executable, ou une version navigateur.

  fangameWeb: {
    name: 'Fangame navigateur',
    short: 'Fangame Web',
    // Joue directement dans une iframe : ni emulateur, ni installation
    runtime: 'html5',
    ext: ['.html', '.htm'],
    bios: null,
    fanmade: true,
  },
  fangamePC: {
    name: 'Fangame PC',
    short: 'Fangame PC',
    runtime: 'native',
    emulator: 'le jeu lui-même',
    ext: ['.exe', '.love', '.jar', '.x86_64', '.appimage'],
    bios: null,
    fanmade: true,
  },
};

/**
 * Reglages d'image, par console.
 *
 * `pixelated` : une console 2D dessine des pixels, pas une image continue.
 * Agrandie avec le lissage du navigateur, son rendu devient flou et sale.
 * En rendu « pixelise », chaque pixel d'origine reste net.
 *
 * `coreOptions` : options passees au coeur libretro. Seule la PSP expose un
 * reglage de resolution interne (verifie : ni mupen64plus_next ni
 * pcsx_rearmed n'en proposent). 960x544 double la definition native de la
 * PSP sans exiger une machine de guerre.
 */
export const VIDEO = {
  nes:     { pixelated: true },
  snes:    { pixelated: true },
  gb:      { pixelated: true },
  gba:     { pixelated: true },
  segaMD:  { pixelated: true },
  segaMS:  { pixelated: true },
  segaGG:  { pixelated: true },
  sg1000:  { pixelated: true },
  segaCD:  { pixelated: true },
  // Consoles 3D : le lissage est preferable, les textures ne sont pas
  // des grilles de pixels
  n64:     { pixelated: false },
  psx:     { pixelated: false },
  psp:     {
    pixelated: false,
    coreOptions: { ppsspp_internal_resolution: '960x544' },
  },
};

export function videoFor(consoleId) {
  return VIDEO[consoleId] || { pixelated: false };
}

/** Extensions qui necessitent une inspection de l'en-tete pour trancher. */
export const AMBIGUOUS_EXT = ['.iso', '.chd', '.bin', '.img', '.cue', '.m3u'];

/** Archives a decompresser avant analyse. */
export const ARCHIVE_EXT = ['.zip', '.7z', '.rar'];

/** Extension -> id de console, pour les cas non ambigus. */
export const EXT_MAP = (() => {
  const map = {};
  for (const [id, c] of Object.entries(CONSOLES)) {
    for (const e of c.ext) map[e] = id;
  }
  return map;
})();

/** Toutes les extensions que Dimstorted sait prendre en charge. */
export const ALL_EXT = [
  ...Object.keys(EXT_MAP),
  ...AMBIGUOUS_EXT,
  ...ARCHIVE_EXT,
];

export function getConsole(id) {
  return CONSOLES[id] || null;
}

/** Ordre d'affichage des rangees sur la page d'accueil. */
export const CONSOLE_ORDER = [
  'psx', 'ps2', 'gamecube', 'dreamcast', 'n64', 'segaMD',
  'snes', 'nes', 'gba', 'gb', 'segaMS', 'segaGG', 'sg1000', 'segaCD', 'psp',
  'fangameWeb', 'fangamePC',
];

/** Plateformes sans base de donnees libretro : metadonnees a saisir a la main. */
export function isFanmade(id) {
  return Boolean(CONSOLES[id]?.fanmade);
}
