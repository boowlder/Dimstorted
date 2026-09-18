/**
 * Catalogue des emulateurs natifs.
 *
 * Dimstorted ne telecharge ni n'installe rien tout seul : ce catalogue sert a
 * indiquer la source officielle de chaque projet, et a connaitre les
 * arguments de ligne de commande corrects.
 *
 * `args` est un gabarit : `{rom}` est remplace par le chemin du jeu au moment
 * du lancement. Les arguments sont passes sous forme de tableau, jamais
 * concatenes en une chaine — c'est ce qui rend toute injection impossible,
 * y compris avec un nom de fichier contenant des guillemets.
 *
 * Les gabarits sont modifiables dans config.json : si un projet change sa
 * ligne de commande, la correction ne demande pas de toucher au code.
 */

export const EMULATORS = {
  pcsx2: {
    name: 'PCSX2',
    console: 'ps2',
    // Verifie sur pcsx2.net/docs/advanced/cli : `--` signale la fin des
    // options, ce qui protege les noms de fichiers a espaces ou a tirets
    args: ['-fullscreen', '-batch', '--', '{rom}'],
    binaries: ['pcsx2-qt.exe', 'pcsx2.exe', 'pcsx2-qt', 'PCSX2.AppImage'],
    source: 'https://pcsx2.net/downloads/',
    repo: 'https://github.com/PCSX2/pcsx2/releases',
    license: 'LGPL / GPL',
    note: 'Nécessite un BIOS PS2 dumpé depuis une console.',
  },
  dolphin: {
    name: 'Dolphin',
    console: 'gamecube',
    // Verifie sur la documentation Dolphin : -b (batch) exige -e (exec)
    args: ['-b', '-e', '{rom}'],
    binaries: ['Dolphin.exe', 'dolphin-emu', 'Dolphin'],
    source: 'https://dolphin-emu.org/download/',
    repo: 'https://github.com/dolphin-emu/dolphin',
    license: 'GPL-2.0',
    note: 'Aucun BIOS requis.',
  },
  flycast: {
    name: 'Flycast',
    console: 'dreamcast',
    args: ['{rom}'],
    binaries: ['flycast.exe', 'flycast', 'Flycast.exe'],
    source: 'https://github.com/flyinghead/flycast/releases',
    repo: 'https://github.com/flyinghead/flycast',
    license: 'GPL-2.0',
    note: 'Nécessite dc_boot.bin et dc_flash.bin dans le dossier BIOS.',
  },
  retroarch: {
    name: 'RetroArch',
    console: null, // generaliste, utilisable en secours
    args: ['-L', '{core}', '{rom}'],
    binaries: ['retroarch.exe', 'retroarch'],
    source: 'https://www.retroarch.com/?page=platforms',
    repo: 'https://github.com/libretro/RetroArch',
    license: 'GPL-3.0',
    note: 'Solution de repli ; demande de préciser le cœur à utiliser.',
  },
};

/** Emulateur attendu pour une console donnee. */
export function emulatorFor(consoleId) {
  return Object.entries(EMULATORS).find(([, e]) => e.console === consoleId)?.[0] || null;
}

/**
 * Les fangames PC n'ont pas d'emulateur : l'executable EST le jeu.
 * Ils suivent le meme circuit d'approbation, jeu par jeu.
 */
export const SELF_LAUNCHING = new Set(['fangamePC']);
