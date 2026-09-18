/**
 * Fabrique des fichiers-temoins pour verifier la detection sans disposer
 * de vrais jeux. Chaque fichier reproduit uniquement la signature binaire
 * que detect.js recherche — le reste est du remplissage.
 */

import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/make-fixtures.js <dossier>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const MB = 1024 * 1024;

function write(name, buf) {
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`  ${name.padEnd(46)} ${(buf.length / MB).toFixed(1)} Mo`);
}

/** Bloc de remplissage avec une chaine placee a un offset precis. */
function blob(size, inserts = []) {
  const buf = Buffer.alloc(size);
  for (const [offset, text] of inserts) buf.write(text, offset, 'ascii');
  return buf;
}

console.log('Fichiers-temoins :');

// Cartouches : l'extension suffit
write('Super Mario Bros 3 (USA).nes', blob(256 * 1024, [[0, 'NES\x1a']]));
write('Sonic The Hedgehog (Europe).md', blob(512 * 1024, [[0x100, 'SEGA MEGA DRIVE']]));
write('Zelda - Ocarina of Time (France) [!].z64', blob(1 * MB));
write('Pokemon Rouge (F).gb', blob(512 * 1024));
write('Columns (World).gg', blob(128 * 1024));
write('Congo Bongo (Japan).sg', blob(32 * 1024));

// GameCube : signature 0xC2339F3D a l'offset 0x1C
const gc = blob(2 * MB);
gc.writeUInt32BE(0xc2339f3d, 0x1c);
write('Zelda Wind Waker (Europe).iso', gc);

// PS2 : SYSTEM.CNF contient BOOT2
write('Gran Turismo 4 (Europe).iso',
  blob(3 * MB, [[0x8001, 'CD001'], [0x9000, 'PLAYSTATION'], [0x20000, 'BOOT2 = cdrom0:\\SCES_123.45;1']]));

// PS1 : zone systeme PlayStation, mais pas de BOOT2
write('Metal Gear Solid (France) (Disc 1).iso',
  blob(2 * MB, [[0x8001, 'CD001'], [0x9000, 'PLAYSTATION'], [0xa000, 'BOOT = cdrom:\\SLES_112.33;1']]));
write('Metal Gear Solid (France) (Disc 2).iso',
  blob(2 * MB, [[0x8001, 'CD001'], [0x9000, 'PLAYSTATION'], [0xa000, 'BOOT = cdrom:\\SLES_112.34;1']]));

// Dreamcast : en-tete SEGA SEGAKATANA dans la piste de donnees
write('Shenmue (Europe).img', blob(2 * MB, [[0, 'SEGA SEGAKATANA SEGA ENTERPRISES']]));

// Mega-CD
write('Sonic CD (Europe).bin', blob(600 * MB > 0 ? 40 * MB : 0, [[0, 'SEGADISCSYSTEM  ']]));

// Paire CUE/BIN : le .bin ne doit PAS apparaitre seul dans la file
const binName = 'Crash Bandicoot (Europe).bin';
write(binName, blob(2 * MB, [[0x8001, 'CD001'], [0x9000, 'PLAYSTATION']]));
fs.writeFileSync(path.join(out, 'Crash Bandicoot (Europe).cue'),
  `FILE "${binName}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n`);
console.log(`  Crash Bandicoot (Europe).cue                   feuille`);

// CHD v5 avec metadonnees de piste CD -> PS1
const chd = Buffer.alloc(4 * MB);
chd.write('MComprHD', 0, 'ascii');
chd.writeUInt32BE(124, 8);               // longueur d'en-tete
chd.writeUInt32BE(5, 12);                // version 5
chd.writeBigUInt64BE(BigInt(650 * MB), 32); // logicalbytes : taille de CD
chd.writeBigUInt64BE(BigInt(4096), 48);  // offset des metadonnees
chd.write('CHT2', 4096, 'ascii');        // tag de piste CD
chd.writeBigUInt64BE(0n, 4104);          // fin de la liste chainee
write('Final Fantasy VII (France) (Disc 1).chd', chd);

// Fichier inconnu : doit tomber en "a confirmer"
write('jeu_mystere_1998.iso', blob(1 * MB));

console.log(`\nEcrits dans ${out}`);
