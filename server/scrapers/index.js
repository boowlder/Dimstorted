/**
 * Orchestrateur du scraping.
 *
 * Un seul travail de fond a la fois, dont l'avancement est interrogeable par
 * l'interface. Chaque jeu est traite independamment : un echec n'interrompt
 * jamais le lot.
 *
 * Regle de prudence : une correspondance jugee incertaine est enregistree mais
 * marquee `uncertain`, pour que l'interface la signale et permette de la
 * corriger. Coller la mauvaise jaquette sur un jeu est pire que ne rien coller.
 */

import { stmt, getGame, listGames } from '../db.js';
import * as launchbox from './launchbox.js';
import { isFanmade } from '../consoles.js';
import { fetchArt, removeArt, suggest } from './thumbnails.js';
import { fetchMetadata } from './metadata.js';
import { releaseInfo } from './releases.js';
import * as cache from './cache.js';
import { resetIndex } from './metadata.js';

const job = {
  running: false,
  total: 0,
  done: 0,
  ok: 0,
  manual: 0,
  uncertain: 0,
  notfound: 0,
  failed: 0,
  current: null,
  startedAt: null,
  finishedAt: null,
  errors: [],
};

/**
 * Complete les metadonnees libretro par LaunchBox.
 *
 * libretro reste prioritaire : ses entrees sont liees au dump exact par CRC,
 * donc a la bonne edition regionale. Mais il ne publie de synopsis que pour
 * les systemes a disque — sur Master System, 1 entree sur 623. LaunchBox ne
 * remplit donc que les cases restees vides.
 */
function completer(game, meta) {
  const manque = ['description', 'year', 'publisher', 'developer', 'genre', 'players']
    .filter((c) => meta[c] === null || meta[c] === undefined);
  if (!manque.length) return meta;

  const lb = launchbox.metadonnees(game.console, [game.title, meta.matched, game.scrape_match]);
  if (!lb) return meta;

  const enrichi = { ...meta };
  for (const c of manque) if (lb[c] !== null) enrichi[c] = lb[c];
  // Un rapprochement LaunchBox vaut comme correspondance : sans lui, un jeu
  // Master System resterait « introuvable » alors qu'il est renseigne
  if (!enrichi.matched) enrichi.matched = lb.matched;
  if (lb.exact) enrichi.confident = true;
  return enrichi;
}

/** Applique a un jeu les resultats des deux sources. */
function persist(game, art, meta) {
  // La capture de gameplay sert de visuel principal (cartes 16/9),
  // la jaquette reste disponible pour la fiche detaillee
  const scores = [art.score, meta.score].filter((s) => s > 0);
  const score = scores.length ? Math.max(...scores) : 0;

  let status = 'notfound';
  if (art.matched || meta.matched) {
    status = (art.confident || meta.confident) ? 'ok' : 'uncertain';
  }

  stmt.applyScrape.run({
    id: game.id,
    cover: art.box,
    snap: art.snap,
    title_img: art.title,
    description: meta.description,
    year: meta.year,
    publisher: meta.publisher,
    developer: meta.developer,
    genre: meta.genre,
    players: meta.players,
    serial: meta.serial,
    scrape_status: status,
    scrape_score: score || null,
    scrape_match: art.matched || meta.matched || null,
    scraped_at: Date.now(),
  });

  return status;
}

/** Scrape un jeu unique. `force` impose un nom de la base libretro. */
export async function scrapeGame(gameId, { force = null } = {}) {
  const game = getGame(gameId);
  if (!game) throw new Error('Jeu introuvable');

  // Les fangames et homebrews n'existent dans aucune base libretro : aller
  // les y chercher ne donnerait rien, et un rapprochement flou risquerait de
  // coller la jaquette d'un jeu commercial homonyme. On s'abstient.
  if (isFanmade(game.console)) {
    stmt.applyScrape.run({
      id: game.id,
      cover: null, snap: null, title_img: null,
      description: null, year: null, publisher: null, developer: null,
      genre: null, players: null, serial: null,
      scrape_status: 'manual',
      scrape_score: null,
      scrape_match: null,
      scraped_at: Date.now(),
    });
    return { status: 'manual', art: {}, meta: {}, release: {}, game: getGame(gameId) };
  }

  if (force) removeArt(game.id);

  const [art, meta, release] = await Promise.all([
    fetchArt(game, { force }).catch((err) => {
      console.warn(`[scraping] images ${game.title} : ${err.message}`);
      return { matched: null, score: 0, confident: false, box: null, snap: null, title: null };
    }),
    fetchMetadata(game, { force }).catch((err) => {
      console.warn(`[scraping] metadonnees ${game.title} : ${err.message}`);
      return { matched: null, score: 0, confident: false };
    }),
    releaseInfo(game).catch((err) => {
      console.warn(`[scraping] sorties ${game.title} : ${err.message}`);
      return { known: false, exclusivity: null };
    }),
  ]);

  const status = persist(game, art, completer(game, meta));
  if (release.known) {
    stmt.setExclusivity.run(release.exclusivity, Date.now(), game.id);
  }
  return { status, art, meta, release, game: getGame(gameId) };
}

/**
 * Lance le scraping du catalogue en arriere-plan.
 * @param {{onlyMissing?: boolean}} opts
 */
export function scrapeAll({ onlyMissing = true } = {}) {
  if (job.running) return { started: false, reason: 'Un scraping est deja en cours' };

  const games = onlyMissing ? stmt.unscraped.all() : listGames();
  if (!games.length) return { started: false, reason: 'Aucun jeu a traiter' };

  Object.assign(job, {
    running: true,
    total: games.length,
    done: 0, ok: 0, manual: 0, uncertain: 0, notfound: 0, failed: 0,
    current: null,
    startedAt: Date.now(),
    finishedAt: null,
    errors: [],
  });

  (async () => {
    for (const g of games) {
      job.current = g.title;
      try {
        const { status } = await scrapeGame(g.id);
        if (status === 'manual') job.manual++;
        else job[status === 'ok' ? 'ok' : status === 'uncertain' ? 'uncertain' : 'notfound']++;
      } catch (err) {
        job.failed++;
        if (job.errors.length < 20) job.errors.push({ title: g.title, error: err.message });
      }
      job.done++;
      // Respiration entre deux jeux : on reste courtois avec un depot public
      await new Promise((r) => setTimeout(r, 120));
    }
    job.current = null;
    job.running = false;
    job.finishedAt = Date.now();
    console.log(`[scraping] termine : ${job.ok} sûrs, ${job.uncertain} incertains, ${job.notfound} introuvables`);
  })();

  return { started: true, total: games.length };
}

export function status() {
  return { ...job };
}

/** Efface les visuels et les marqueurs d'un jeu, sans toucher aux fichiers. */
export function resetGame(gameId) {
  removeArt(gameId);
  stmt.clearScrape.run(gameId);
  return getGame(gameId);
}

export { suggest };

export function clearCache() {
  const removed = cache.clear();
  resetIndex();
  return { removed, ...cache.stats() };
}

export function cacheStats() {
  return cache.stats();
}
