/**
 * Verification de bout en bout des sauvegardes d'etat.
 *
 * Le scenario reproduit exactement l'usage reel :
 *   1. lancer le jeu depuis l'accueil
 *   2. laisser tourner, puis quitter via le bouton
 *   3. verifier que le serveur a bien recu un etat et une capture
 *   4. relancer avec reprise et verifier que l'etat est reinjecte
 *
 * Un test qui se contenterait d'appeler l'API ne prouverait rien : tout
 * l'enjeu est que l'emulateur produise un etat exploitable et sache le
 * relire.
 */

import puppeteer from 'puppeteer-core';

const base = process.argv[2] || 'http://127.0.0.1:1985';

/*
 * Sans numero donne, on prend le premier jeu jouable dans le navigateur.
 * Un numero en dur ne survit pas a une bibliotheque : les identifiants ne
 * repartent pas de 1 quand on vide le catalogue, et le test echouait sur un
 * « Jeu introuvable » qui n'avait rien a voir avec les sauvegardes.
 */
const catalogue = await (await fetch(`${base}/api/games`)).json();
const gameId = process.argv[3]
  || catalogue.find((g) => g.runtime === 'web')?.id
  || catalogue[0]?.id;
if (!gameId) { console.error('bibliotheque vide'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const problems = [];
page.on('pageerror', (e) => problems.push(`JS: ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });

const step = (n, t) => console.log(`\n[${n}] ${t}`);

// --- 1. etat initial ------------------------------------------------------
step(1, 'Etat initial des sauvegardes');
let before = await (await fetch(`${base}/api/games/${gameId}/saves`)).json();
console.log(`    sauvegardes existantes : ${before.length}`);

// --- 2. lancer et laisser tourner ----------------------------------------
step(2, 'Lancement du jeu depuis l\'accueil');
await page.goto(base, { waitUntil: 'networkidle2' });
await page.waitForSelector('.card', { timeout: 20000 });

await page.evaluate((id) => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.dataset.id === String(id));
  (card || document.querySelector('.card')).click();
}, gameId);
await page.waitForSelector('#view-detail:not([hidden])', { timeout: 10000 });
await page.evaluate(() => document.querySelector('.detail-play').click());
await page.waitForSelector('#view-player:not([hidden])', { timeout: 10000 });
console.log('    lecteur ouvert');

// L'emulateur doit avoir demarre : on attend le signal du lecteur
const started = await page.evaluate(() => new Promise((resolve) => {
  const onMsg = (e) => {
    if (e.data?.type === 'dimstorted:ready') { removeEventListener('message', onMsg); resolve(true); }
  };
  addEventListener('message', onMsg);
  setTimeout(() => resolve(false), 90000);
}));
console.log(`    emulateur pret : ${started ? 'OUI' : 'NON'}`);
if (!started) { await browser.close(); process.exit(1); }

await new Promise((r) => setTimeout(r, 4000));

// --- 3. quitter, ce qui doit declencher la sauvegarde ---------------------
step(3, 'Sortie par le bouton Quitter');
await page.evaluate(() => document.querySelector('#btn-quit').click());
await page.waitForFunction(() => document.querySelector('#view-player').hidden,
  { timeout: 25000 }).catch(() => console.log('    (le lecteur ne s\'est pas ferme a temps)'));
await new Promise((r) => setTimeout(r, 2500));

const after = await (await fetch(`${base}/api/games/${gameId}/saves`)).json();
const auto = after.find((s) => s.slot === 0);
console.log(`    sauvegardes apres sortie : ${after.length}`);
console.log(`    etat automatique         : ${auto ? `${auto.size} octets` : 'ABSENT'}`);
console.log(`    capture d'ecran          : ${auto?.shot ? 'OUI' : 'non'}`);
if (!auto) { await browser.close(); process.exit(1); }

// --- 4. la fiche doit proposer « Reprendre » -----------------------------
step(4, 'La fiche propose-t-elle la reprise ?');
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.card', { timeout: 20000 });
const ui = await page.evaluate((id) => {
  const rows = [...document.querySelectorAll('.row')];
  const resumeRow = rows.find((r) => r.querySelector('.row-title')?.textContent.includes('Reprendre'));
  const card = [...document.querySelectorAll('.card')].find((c) => c.dataset.id === String(id));
  card?.click();
  const label = document.querySelector('.play-label')?.textContent;
  const restart = document.querySelector('.detail-restart');
  return {
    rangeeReprendre: Boolean(resumeRow),
    cartesDansRangee: resumeRow ? resumeRow.querySelectorAll('.card').length : 0,
    boutonPrincipal: label,
    boutonRecommencer: restart && !restart.hidden,
    // Les cartes montrent la jaquette du jeu, decision assumee : la
    // capture de la partie s'affiche sur la fiche, dans la liste des
    // sauvegardes, la ou elle sert vraiment a se reperer.
    badgeReprendre: Boolean(resumeRow?.querySelector('.card-resume')),
  };
}, gameId);

await new Promise((r) => setTimeout(r, 600));
const vignetteFiche = await page.evaluate(
  () => Boolean(document.querySelector('.detail-saves img[src*="/saves/"]')),
);
console.log(`    rangee « Reprendre la partie » : ${ui.rangeeReprendre ? `oui (${ui.cartesDansRangee} jeu)` : 'NON'}`);
console.log(`    badge « Reprendre » sur la carte : ${ui.badgeReprendre ? 'oui' : 'NON'}`);
console.log(`    capture de la partie sur la fiche : ${vignetteFiche ? 'oui' : 'NON'}`);
console.log(`    bouton principal                : « ${ui.boutonPrincipal} »`);
console.log(`    bouton « Recommencer » visible  : ${ui.boutonRecommencer ? 'oui' : 'NON'}`);

// --- 5. la reprise recharge-t-elle reellement l'etat ? -------------------
step(5, 'Relance avec reprise');
await page.evaluate(() => document.querySelector('.detail-play').click());
await page.waitForSelector('#view-player:not([hidden])', { timeout: 10000 });
const resumed = await page.evaluate(() => new Promise((resolve) => {
  const onMsg = (e) => {
    if (e.data?.type === 'dimstorted:resumed') { removeEventListener('message', onMsg); resolve(e.data.ok); }
  };
  addEventListener('message', onMsg);
  setTimeout(() => resolve(null), 90000);
}));
console.log(`    etat reinjecte dans l'emulateur : ${resumed === true ? 'OUI' : resumed === false ? 'NON' : 'pas de reponse'}`);

await browser.close();

console.log('');
if (problems.length) {
  console.log('Anomalies :');
  for (const p of [...new Set(problems)].slice(0, 8)) console.log('  ', p.slice(0, 130));
} else {
  console.log('Aucune erreur JS ni requete en echec.');
}

const pass = Boolean(auto) && ui.boutonPrincipal === 'Reprendre' && resumed === true;
console.log(pass ? '\nRESULTAT : la chaine complete fonctionne.' : '\nRESULTAT : au moins une etape a echoue.');
process.exit(pass ? 0 : 1);
