/**
 * Traduction des genres.
 *
 * LaunchBox publie ses genres en anglais et le vocabulaire est court et
 * ferme : une table suffit, inutile d'aller chercher plus loin. Un genre
 * inconnu est laisse tel quel plutot que deforme.
 */
const FR = {
  'platform': 'Plateforme',
  'action': 'Action',
  'role-playing (rpg)': 'Jeu de rôle',
  'role-playing': 'Jeu de rôle',
  'rpg': 'Jeu de rôle',
  'racing': 'Course',
  'sports': 'Sport',
  'puzzle': 'Réflexion',
  'shooter': 'Tir',
  'adventure': 'Aventure',
  "beat'em up": 'Beat them all',
  'strategy': 'Stratégie',
  'fighting': 'Combat',
  'simulation': 'Simulation',
  "shoot'em up": 'Shoot them up',
  'pinball': 'Flipper',
  'compilation': 'Compilation',
  'arcade': 'Arcade',
  'educational': 'Éducatif',
  'horror': 'Horreur',
  'music': 'Musique',
  'party': 'Party game',
  'sandbox': 'Bac à sable',
  'stealth': 'Infiltration',
  'survival': 'Survie',
  'flight simulator': 'Simulation de vol',
  'life simulation': 'Simulation de vie',
  'construction and management simulation': 'Gestion',
  'quiz': 'Quiz',
  'board game': 'Jeu de plateau',
  'card game': 'Jeu de cartes',
  'sport': 'Sport',
};

export function genreFr(genre) {
  if (!genre) return null;
  return FR[String(genre).trim().toLowerCase()] || genre;
}
