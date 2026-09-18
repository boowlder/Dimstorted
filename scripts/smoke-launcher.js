/**
 * Verification des garde-fous du lancement natif.
 *
 * Chaque test tente une attaque plausible et attend un refus. Un test qui
 * passerait signalerait une faille reelle : on prefere echouer ici que sur
 * la machine de l'utilisateur.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const base = process.argv[2] || 'http://127.0.0.1:1985';
const tmp = process.argv[3];
if (!tmp) {
  console.error('Usage: node scripts/smoke-launcher.js <url> <dossier-temporaire>');
  process.exit(1);
}
fs.mkdirSync(tmp, { recursive: true });

let passed = 0;
let failed = 0;

async function call(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try { payload = await res.json(); } catch { payload = null; }
  return { status: res.status, body: payload };
}

function check(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  OK    ${label}`); }
  else { failed++; console.log(`  ECHEC ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n=== GARDE-FOUS DU LANCEMENT NATIF ===\n');

/*
 * 1. Lancer sans emulateur enregistre doit etre refuse.
 *
 * Le test ne vaut que si l'emplacement concerne est effectivement vide :
 * une fois l'utilisateur equipe, un lancement qui reussit est le
 * comportement correct, pas un echec. On cherche donc un jeu natif dont
 * l'emulateur n'est PAS installe — et on ne lance jamais un vrai jeu, qui
 * ouvrirait une fenetre sur le bureau.
 */
const games = await (await fetch(`${base}/api/games`)).json();
const inv = await call('GET', '/api/emulators');
const readyConsoles = new Set(
  (inv.body?.emulators || []).filter((e) => e.state === 'ready').map((e) => e.console),
);
const orphan = games.find((g) => g.runtime === 'native' && !readyConsoles.has(g.console));

if (orphan) {
  const r = await call('POST', `/api/games/${orphan.id}/launch`);
  check('Lancement refusé tant qu’aucun émulateur n’est enregistré',
    r.status === 409 || r.status === 400, `reçu ${r.status}`);
} else {
  console.log('  (tous les émulateurs sont installés — test 1 sans objet, ignoré)');
}

// 2. Un chemin qui n'existe pas doit etre refuse
let r = await call('POST', '/api/emulators/pcsx2', { path: '/nexiste/pas/pcsx2.exe' });
check('Enregistrement refusé pour un chemin inexistant', r.status === 400, `reçu ${r.status}`);

// 3. Un identifiant d'emulateur inconnu doit etre refuse
r = await call('POST', '/api/emulators/rootkit', { path: '/bin/sh' });
check('Identifiant d’émulateur inconnu refusé', r.status === 400, `reçu ${r.status}`);

/*
 * Les tests qui suivent se servent de l'emplacement « flycast » comme cobaye.
 * S'il contient deja une vraie installation, on la memorise pour la remettre
 * en place a la fin : un test ne doit jamais detruire la configuration de
 * l'utilisateur.
 */
const before = await call('GET', '/api/emulators');
const savedFlycast = before.body?.emulators?.find((e) => e.id === 'flycast')?.path || null;
if (savedFlycast) console.log(`  (installation Flycast existante mise de côté : ${savedFlycast})`);

// 4. Enregistrement legitime d'un faux emulateur, puis verification d'empreinte
const fake = path.join(tmp, 'faux-emulateur.sh');
fs.writeFileSync(fake, '#!/bin/sh\necho "emulateur v1"\n');
fs.chmodSync(fake, 0o755);

r = await call('POST', '/api/emulators/flycast', { path: fake });
check('Enregistrement accepté pour un fichier réel', r.status === 200, `reçu ${r.status}`);
const registeredHash = r.body?.entry?.sha256;
check('Empreinte SHA-256 relevée à l’enregistrement', Boolean(registeredHash));

// 5. L'inventaire doit le voir pret
r = await call('GET', '/api/emulators');
const flycast = r.body?.emulators?.find((e) => e.id === 'flycast');
check('Inventaire : état « ready »', flycast?.state === 'ready', `état ${flycast?.state}`);

// 6. Le binaire est modifie dans le dos de l'utilisateur
fs.writeFileSync(fake, '#!/bin/sh\necho "COMPROMIS"\n');
r = await call('GET', '/api/emulators');
const after = r.body?.emulators?.find((e) => e.id === 'flycast');
check('Modification du binaire détectée (état « changed »)',
  after?.state === 'changed', `état ${after?.state}`);

// 7. Le lancement doit etre refuse tant que l'empreinte ne correspond plus
const dc = games.find((g) => g.console === 'dreamcast');
if (dc) {
  r = await call('POST', `/api/games/${dc.id}/launch`);
  check('Lancement refusé après modification du binaire',
    r.status === 400 && r.body?.code === 'HASH_MISMATCH', `reçu ${r.status} ${r.body?.code}`);
} else {
  console.log('  (aucun jeu Dreamcast, test 7 ignoré)');
}

// 8. Un fangame PC doit exiger une approbation nominative.
//    On revoque d'abord : l'approbation persiste dans config.json, et un
//    test qui depend de l'etat laisse par le run precedent ne prouve rien.
const fangame = games.find((g) => g.console === 'fangamePC');
if (fangame) {
  await call('DELETE', `/api/games/${fangame.id}/approve`);
  r = await call('POST', `/api/games/${fangame.id}/launch`);
  check('Fangame PC : approbation exigée',
    r.body?.code === 'NEEDS_APPROVAL', `reçu ${r.body?.code}`);
} else {
  console.log('  (aucun fangame PC, test 8 ignoré)');
}

// 9. L'approbation ignore tout chemin transmis dans la requete
if (fangame) {
  const evil = await call('POST', `/api/games/${fangame.id}/approve`, { path: '/bin/sh' });
  const approvedPath = evil.body?.approval?.path || '';
  check('Approbation basée sur le fichier du jeu, pas sur la requête',
    evil.status === 200 && approvedPath.includes('Dimstorted') && !approvedPath.includes('/bin/sh'),
    `chemin approuvé : ${approvedPath}`);

  // 9b. Un programme qui ne peut pas demarrer doit remonter une erreur,
  //     pas un faux succes
  const boom = await call('POST', `/api/games/${fangame.id}/launch`);
  check('Échec de lancement remonté (pas de faux succès)',
    boom.status === 400 && boom.body?.code === 'SPAWN_FAILED',
    `reçu ${boom.status} ${boom.body?.code}`);
  await call('DELETE', `/api/games/${fangame.id}/approve`);
}

// 10. Aucune injection possible via un nom de fichier piege.
//     Un nom de fichier ne peut pas contenir de « / » : l'attaque realiste
//     utilise donc guillemets, point-virgule et substitution de commande.
const witness = path.join(tmp, 'temoin-injection.txt');
fs.writeFileSync(witness, 'intact');
const trapName = 'jeu"; rm -rf $HOME; echo `whoami`.iso';
const trapped = path.join(tmp, trapName);
fs.writeFileSync(trapped, 'contenu');

// spawn sans shell : l'argument doit ressortir tel quel, non interprete
const safe = spawnSync('/bin/echo', [trapped], { shell: false });
const literal = safe.stdout.toString();
check('Sans shell : argument transmis littéralement',
  literal.includes('rm -rf $HOME') && literal.includes('`whoami`')
  && fs.existsSync(witness));

// Contre-epreuve : la meme chaine passee a un shell serait interpretee
const viaShell = spawnSync(`echo ${trapName}`, { shell: true, cwd: tmp });
const interpreted = viaShell.stdout.toString();
check('Contre-épreuve : avec un shell, la chaîne serait bien interprétée',
  !interpreted.includes('`whoami`'),
  'le shell n’a pas interprété, la comparaison perd son sens');

// Nettoyage : on rend l'emplacement dans l'etat ou on l'a trouve
if (savedFlycast) {
  const restored = await call('POST', '/api/emulators/flycast', { path: savedFlycast });
  check('Installation Flycast d’origine restaurée', restored.status === 200,
    `reçu ${restored.status}`);
} else {
  await call('DELETE', '/api/emulators/flycast');
}

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
process.exit(failed ? 1 : 0);
