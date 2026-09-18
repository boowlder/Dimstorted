/**
 * Verification de bout en bout du lecteur.
 *
 * Ouvre la page de lecture dans un vrai navigateur, attend que l'emulateur
 * ait demarre, et capture l'ecran. Remonte toutes les erreurs console et les
 * requetes reseau en echec : c'est le seul moyen de prouver que la chaine
 * complete fonctionne, du fichier sur le disque jusqu'au rendu.
 */

import puppeteer from 'puppeteer-core';

const url = process.argv[2];
const shot = process.argv[3];
if (!url || !shot) {
  console.error('Usage: node scripts/smoke-player.js <url> <capture.png>');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--window-size=1100,760',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 760 });

const logs = [];
const failures = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => failures.push(`ERREUR JS: ${e.message}`));
page.on('requestfailed', (r) => failures.push(`RESEAU: ${r.url().slice(0, 110)} — ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// L'emulateur est considere demarre quand un <canvas> est rendu avec une taille
let started = false;
try {
  await page.waitForFunction(() => {
    const c = document.querySelector('#game canvas');
    return c && c.width > 0 && c.height > 0;
  }, { timeout: 75000, polling: 500 });
  started = true;
} catch { /* le diagnostic ci-dessous dira pourquoi */ }

// Quelques secondes de plus pour laisser tourner la ROM et afficher une image
await new Promise((r) => setTimeout(r, started ? 6000 : 2000));

const diag = await page.evaluate(() => {
  const canvas = document.querySelector('#game canvas');
  const msg = document.getElementById('msg');
  let pixel = null;
  if (canvas) {
    try {
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
      const d = tmp.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      pixel = `rgb(${d[0]},${d[1]},${d[2]})`;
    } catch (e) { pixel = `illisible: ${e.message}`; }
  }
  return {
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'absent',
    pixelCentral: pixel,
    messageVisible: msg && !msg.hidden ? msg.innerText.replace(/\s+/g, ' ').trim() : null,
    titre: document.title,
  };
});

await page.screenshot({ path: shot });
await browser.close();

console.log('--- DIAGNOSTIC ---');
console.log('Canvas           :', diag.canvas);
console.log('Pixel central    :', diag.pixelCentral);
console.log('Titre de page    :', diag.titre);
console.log('Message a l ecran:', diag.messageVisible ?? '(aucun — l emulateur occupe la page)');
console.log('Emulateur demarre:', started ? 'OUI' : 'NON');

if (failures.length) {
  console.log('\n--- ECHECS ---');
  for (const f of [...new Set(failures)].slice(0, 12)) console.log(' ', f);
}
const notable = logs.filter((l) => /error|fail|warn/i.test(l)).slice(0, 8);
if (notable.length) {
  console.log('\n--- CONSOLE ---');
  for (const l of notable) console.log(' ', l.slice(0, 160));
}
process.exit(started ? 0 : 1);
