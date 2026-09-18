/**
 * Capture les ecrans de l'interface qui demandent une interaction
 * (fiche de jeu, correcteur de jaquette) — impossibles a atteindre avec une
 * simple capture d'URL.
 *
 * Usage : node scripts/shoot-ui.js <url-de-base> <dossier-de-sortie>
 */

import puppeteer from 'puppeteer-core';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:1985';
const out = process.argv[3];
if (!out) {
  console.error('Usage: node scripts/shoot-ui.js <url> <dossier>');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1080 });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

await page.goto(base, { waitUntil: 'networkidle2' });
await page.waitForSelector('.card', { timeout: 15000 });

// Fiche d'un jeu entierement renseigne
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')];
  const target = cards.find((c) => c.querySelector('.card-badge')?.textContent.includes('PS1'));
  (target || cards[0]).click();
});
await page.waitForSelector('#view-detail:not([hidden])', { timeout: 8000 });
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(out, 'v1-detail.png') });
console.log('  fiche de jeu capturee');

// Correcteur de jaquette
const hasFix = await page.evaluate(() => {
  const btn = document.querySelector('.detail-scrape .fix-btn, .detail-scrape .link-btn');
  if (!btn) return false;
  btn.click();
  return true;
});
if (hasFix) {
  await page.waitForSelector('#view-fixer:not([hidden])', { timeout: 8000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#fixer-results .fixer-item').length > 0,
    { timeout: 25000, polling: 400 },
  ).catch(() => console.log('  (aucune proposition revenue)'));
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(out, 'v1-fixer.png') });
  console.log('  correcteur de jaquette capture');
}

await browser.close();

if (errors.length) {
  console.log('\nAnomalies :');
  for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ', e.slice(0, 130));
} else {
  console.log('\nAucune erreur JS ni requete en echec.');
}
