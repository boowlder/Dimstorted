/**
 * Sonde la disponibilite des metadonnees libretro pour chaque console de
 * Dimstorted. Sert a decider, avec des faits, quelles sources cabler en V1.
 */

const BASE = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat';

const SYSTEMS = {
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  n64: 'Nintendo - Nintendo 64',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance',
  gamecube: 'Nintendo - GameCube',
  segaMD: 'Sega - Mega Drive - Genesis',
  segaMS: 'Sega - Master System - Mark III',
  segaGG: 'Sega - Game Gear',
  sg1000: 'Sega - SG-1000',
  segaCD: 'Sega - Mega-CD - Sega CD',
  dreamcast: 'Sega - Dreamcast',
  psx: 'Sony - PlayStation',
  ps2: 'Sony - PlayStation 2',
  psp: 'Sony - PlayStation Portable',
};

const FOLDERS = ['developer', 'genre', 'releaseyear', 'publisher', 'maxusers'];

async function head(url) {
  try {
    const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-3000' } });
    if (!r.ok) return { ok: false };
    const text = await r.text();
    return { ok: true, hasDescription: text.includes('description "') && text.includes('developer "') };
  } catch {
    return { ok: false };
  }
}

console.log('Couverture des metadonnees libretro\n');
console.log('CONSOLE'.padEnd(12), FOLDERS.map((f) => f.slice(0, 9).padEnd(10)).join(''), 'SYNOPSIS');
console.log('-'.repeat(80));

for (const [id, name] of Object.entries(SYSTEMS)) {
  const cells = [];
  let rich = false;
  for (const folder of FOLDERS) {
    const r = await head(`${BASE}/${folder}/${encodeURIComponent(name)}.dat`);
    cells.push((r.ok ? 'oui' : '—').padEnd(10));
    if (folder === 'developer' && r.hasDescription) rich = true;
  }
  console.log(id.padEnd(12), cells.join(''), rich ? 'OUI' : '—');
}
