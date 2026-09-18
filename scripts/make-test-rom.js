/**
 * Genere une ROM NES authentique et minimale (format iNES).
 *
 * Elle ne fait qu'une chose : attendre l'initialisation du PPU, ecrire une
 * couleur de fond dans la palette, puis boucler. Si l'ecran de l'emulateur
 * devient bleu, c'est que toute la chaine fonctionne — service HTTP du
 * fichier, coeur d'emulation, et rendu.
 */

import fs from 'node:fs';

// Code 6502 assemble a la main, place a $C000
const CODE = [
  0x78,                    // SEI
  0xd8,                    // CLD
  0xa2, 0x40,              // LDX #$40
  0x8e, 0x17, 0x40,        // STX $4017   desactive l'IRQ du compteur APU
  0xa2, 0xff,              // LDX #$FF
  0x9a,                    // TXS         initialise la pile
  0xe8,                    // INX         X = 0
  0x8e, 0x00, 0x20,        // STX $2000   PPUCTRL = 0
  0x8e, 0x01, 0x20,        // STX $2001   PPUMASK = 0 (rendu desactive)
  0x2c, 0x02, 0x20,        // BIT $2002   1re attente de vblank
  0x10, 0xfb,              // BPL -5
  0x2c, 0x02, 0x20,        // BIT $2002   2e attente : le PPU est pret
  0x10, 0xfb,              // BPL -5
  0xa9, 0x3f,              // LDA #$3F
  0x8d, 0x06, 0x20,        // STA $2006   adresse VRAM haute = $3F
  0xa9, 0x00,              // LDA #$00
  0x8d, 0x06, 0x20,        // STA $2006   adresse VRAM basse = $00 -> $3F00
  0xa9, 0x12,              // LDA #$12    bleu
  0x8d, 0x07, 0x20,        // STA $2007   ecrit la couleur de fond
  0xa9, 0x3f,              // LDA #$3F
  0x8d, 0x06, 0x20,        // STA $2006
  0xa9, 0x00,              // LDA #$00
  0x8d, 0x06, 0x20,        // STA $2006   repointe sur $3F00 pour l'affichage
  0x4c, 0x34, 0xc0,        // JMP $C034   boucle infinie
];

const PRG_SIZE = 16 * 1024;
const CHR_SIZE = 8 * 1024;

const header = Buffer.alloc(16);
header.write('NES\x1a', 0, 'binary');
header[4] = 1; // 1 banque PRG de 16 Ko
header[5] = 1; // 1 banque CHR de 8 Ko

const prg = Buffer.alloc(PRG_SIZE);
Buffer.from(CODE).copy(prg, 0);

// Vecteurs d'interruption, en fin de banque : NMI, RESET, IRQ
prg.writeUInt16LE(0xc034, 0x3ffa); // NMI   -> la boucle
prg.writeUInt16LE(0xc000, 0x3ffc); // RESET -> le debut du code
prg.writeUInt16LE(0xc034, 0x3ffe); // IRQ   -> la boucle

const rom = Buffer.concat([header, prg, Buffer.alloc(CHR_SIZE)]);

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/make-test-rom.js <fichier.nes>');
  process.exit(1);
}
fs.writeFileSync(out, rom);
console.log(`ROM NES ecrite : ${out} (${rom.length} octets)`);
