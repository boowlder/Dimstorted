/**
 * Console Dimstorted -> nom(s) de plateforme chez LaunchBox.
 *
 * Table partagee entre le script de preparation et le module de recherche,
 * pour qu'ils ne puissent pas diverger.
 */
export const PLATEFORMES = {
  nes: ['Nintendo Entertainment System'],
  snes: ['Super Nintendo Entertainment System'],
  n64: ['Nintendo 64'],
  gb: ['Nintendo Game Boy', 'Nintendo Game Boy Color'],
  gba: ['Nintendo Game Boy Advance'],
  gamecube: ['Nintendo GameCube'],
  segaMD: ['Sega Genesis', 'Sega Mega Drive'],
  segaMS: ['Sega Master System'],
  segaGG: ['Sega Game Gear'],
  segaCD: ['Sega CD', 'Sega 32X'],
  sg1000: ['Sega SG-1000'],
  dreamcast: ['Sega Dreamcast'],
  psx: ['Sony Playstation'],
  ps2: ['Sony Playstation 2'],
  psp: ['Sony PSP'],
};
