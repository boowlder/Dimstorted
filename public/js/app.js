/* Dimstorted — interface */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Couleur d'identite par console, utilisee pour les jaquettes de substitution
   tant qu'aucune image n'a ete recuperee. */
const CONSOLE_COLORS = {
  psx: ['#2e3192', '#0d0d3d'], ps2: ['#1b1b6f', '#05051f'],
  gamecube: ['#5b3a9c', '#1e1136'], dreamcast: ['#e35205', '#4a1a00'],
  n64: ['#1d7a3e', '#062814'], segaMD: ['#0057b8', '#001a3d'],
  snes: ['#5b4b9e', '#1c1636'], nes: ['#b32020', '#3a0808'],
  gba: ['#5a4fcf', '#1b1740'], gb: ['#6b8f3a', '#1f2a0f'],
  segaMS: ['#c02026', '#3b0709'], segaGG: ['#1d6fa5', '#062434'],
  sg1000: ['#8a6d1f', '#2b2006'], segaCD: ['#0d5aa7', '#041d35'],
  psp: ['#2b2b2b', '#0a0a0a'],
  fangameWeb: ['#1f6f5c', '#08231d'], fangamePC: ['#6b4a1f', '#241706'],
};

/* Consoles dont on a le logo dans public/theme/logos/ */
const LOGOS_CONSOLE = new Set(['nes', 'snes', 'n64', 'gb', 'gba', 'gamecube',
  'segaMD', 'segaMS', 'segaGG', 'segaCD', 'sg1000', 'dreamcast', 'psx', 'ps2', 'psp']);

/*
 * ARTFLIX montre les machines plutot que d'en ecrire le nom : un logo de
 * Dreamcast se reconnait instantanement, « Sega Dreamcast » se lit. On garde
 * le texte en repli, et pour les plateformes sans logo.
 */
/*
 * Les visuels de `public/theme/` viennent d'un theme tiers qu'on ne
 * redistribue pas : le depot public en est depourvu. Tout ce qui les utilise
 * passe donc par ces deux fonctions, qui se rabattent sur un aplat aux
 * couleurs de la machine et sur son nom ecrit.
 */
function themePresent() {
  return Boolean(state.status?.theme);
}

function aplatConsole(consoleId) {
  const [a, b] = CONSOLE_COLORS[consoleId] || ['#3a3a3a', '#141414'];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function marqueConsole(el, game) {
  el.textContent = game.consoleName;
  el.classList.remove('avec-logo');
  el.style.backgroundImage = '';
  if (themePresent() && LOGOS_CONSOLE.has(game.console)) {
    el.classList.add('avec-logo');
    el.style.backgroundImage = `url(/theme/logos/${game.console}.png)`;
  }
}

const state = {
  games: [],
  consoles: [],
  consoleChoisie: null,
  heroPile: [],
  profiles: [],
  profile: null,
  profileColors: [],
  status: null,
  view: 'home',
  query: '',
  filters: { console: '', genre: '', year: '', players: '', sort: 'title' },
  playing: null,
  playStart: 0,
};

/* ------------------------------------------------------------------ API */

async function api(url, options) {
  const res = await fetch(url, options);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || `Erreur ${res.status}`);
  return body;
}

async function refresh() {
  const [games, consoles, status, profiles] = await Promise.all([
    api('/api/games'), api('/api/consoles'), api('/api/status'), api('/api/profiles'),
  ]);
  state.games = games;
  state.consoles = consoles;
  state.status = status;
  state.profiles = profiles.profiles;
  state.profile = profiles.profiles.find((p) => p.id === profiles.current) || null;
  state.profileColors = profiles.colors;
  majEffetsDisponibles();
  renderAvatar();
  render();
  renderQueueCount();
}

/* -------------------------------------------------------------- Rendu */

/**
 * Visuel large (bannière, fiche) : la capture de gameplay, car une jaquette
 * portrait étirée sur toute la largeur serait ratée.
 */
function artStyle(game) {
  // L'illustration dessinee d'abord : c'est elle qui fait l'image d'ARTFLIX.
  // La capture de gameplay ensuite, l'aplat de couleur en dernier recours.
  if (game.fanart) return `background-image:url(${game.fanart})`;
  if (game.art) return `background-image:url(${game.art})`;
  if (game.cover) return `background-image:url(${game.cover});background-position:center 28%`;
  const [a, b] = CONSOLE_COLORS[game.console] || ['#3a3a3a', '#141414'];
  return `background-image:linear-gradient(135deg, ${a}, ${b})`;
}

/**
 * Visuel de vignette : la jaquette du jeu, et elle seule.
 *
 * Les jaquettes n'ont pas toutes le même format — boîte de cartouche en
 * portrait (0,71), boîtier CD carré (1,00). On les affiche donc entières
 * plutôt que recadrées : rogner un boîtier carré dans une vignette portrait
 * amputerait le titre, c'est-à-dire exactement ce qu'on vient chercher.
 */
function tileArt(game) {
  return game.cover || game.art || null;
}

/** Visuel portrait : la jaquette, quand elle a été récupérée. */
function posterStyle(game) {
  if (game.cover) return `background-image:url(${game.cover})`;
  const [a, b] = CONSOLE_COLORS[game.console] || ['#3a3a3a', '#141414'];
  return `background-image:linear-gradient(160deg, ${a}, ${b})`;
}

/*
 * Note du public, en etoiles.
 *
 * LaunchBox note sur cinq avec des decimales — 3,8 par exemple. On arrondit
 * au demi le plus proche et on affiche la valeur exacte a cote : l'oeil lit
 * les etoiles, qui veut le detail l'a.
 */
function etoiles(note) {
  if (!note) return '';
  // Une seule etoile pour les deux etats, eteinte ou allumee : les demi-
  // etoiles n'existent pas dans toutes les polices et se seraient affichees
  // en carre vide chez qui n'a pas la bonne. La valeur exacte est a cote.
  const pleines = Math.round(note);
  let out = '';
  for (let i = 1; i <= 5; i += 1) {
    out += i <= pleines ? '★' : '<span class="vide">★</span>';
  }
  return `${out}<small>${note.toFixed(1).replace('.', ',')} / 5</small>`;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} Go`;
  const mo = bytes / 1024 ** 2;
  // Une cartouche de 256 Ko s'affichait « 0 Mo »
  return mo >= 1 ? `${Math.round(mo)} Mo` : `${Math.round(bytes / 1024)} Ko`;
}

function fmtPlaytime(seconds) {
  // En dessous d'une minute, afficher « 0 min » ne dit rien d'utile
  if (!seconds || seconds < 60) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/* ----------------------------------------------------- Grille des consoles */

/**
 * Chaque machine en grande tuile : son illustration en fond, son logo
 * detoure par-dessus.
 *
 * Les visuels viennent du theme Alekfull-ARTFLIX, dont c'est tout le propos :
 * montrer les machines plutot que d'en ecrire le nom. Un logo de Mega Drive
 * se reconnait en un dixieme de seconde ; « Sega Mega Drive » se lit.
 */
function grilleConsoles() {
  const el = document.createElement('div');
  el.className = 'grille-consoles';

  const avecJeux = state.consoles.filter((c) => c.count);
  el.innerHTML = avecJeux.map((c) => `
    <button class="tuile-console" data-console="${c.id}" aria-label="${escapeHtml(c.name)}">
      <span class="tc-art" style="background-image:${themePresent()
        ? `url(/theme/arts/${c.id}.jpg)` : aplatConsole(c.id)}"></span>
      <span class="tc-voile"></span>
      ${themePresent()
        ? `<span class="tc-logo" style="background-image:url(/theme/logos/${c.id}.png)"></span>`
        : ''}
      <span class="tc-bas">
        <span class="tc-nom">${escapeHtml(c.name)}</span>
        <span class="tc-nb">${c.count} jeu${c.count > 1 ? 'x' : ''}</span>
      </span>
    </button>`).join('');

  $$('[data-console]', el).forEach((b) => {
    b.onclick = () => {
      state.consoleChoisie = b.dataset.console;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
  return el;
}

/** Banniere de la console ouverte, avec le retour vers la grille. */
function enteteConsole(c) {
  const el = document.createElement('div');
  el.className = 'entete-console';
  el.style.backgroundImage = themePresent()
    ? `url(/theme/arts/${c.id}.jpg)` : aplatConsole(c.id);
  el.innerHTML = `
    <div class="ec-voile"></div>
    <div class="ec-contenu">
      <button class="ec-retour">&larr; Toutes les consoles</button>
      ${themePresent()
        ? `<div class="ec-logo" style="background-image:url(/theme/logos/${c.id}.png)"></div>`
        : `<h2 class="ec-nom">${escapeHtml(c.name)}</h2>`}
      <p class="ec-nb">${c.count} jeu${c.count > 1 ? 'x' : ''}</p>
    </div>`;
  $('.ec-retour', el).onclick = () => { state.consoleChoisie = null; render(); };
  return el;
}

function card(game, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  el.tabIndex = 0;
  el.dataset.id = game.id;
  const native = game.runtime === 'native'
    ? `<div class="card-native">PC</div>` : '';
  // Un jeu jamais sorti en Occident merite d'etre signale : c'est la raison
  // meme de garder une version japonaise dans une bibliotheque francophone
  const excl = game.exclusivity
    ? `<div class="card-excl" title="Jamais sorti en Europe sous ce titre">${flag(game.exclusivity)} EXCLU</div>`
    : '';
  const multi = game.hasDuplicates
    ? `<div class="card-multi" title="Plusieurs éditions régionales">${flag(game.edition)}</div>` : '';
  const discs = game.discs > 1 ? ` · ${game.discs} disques` : '';
  const sub = [game.year, game.genre, game.region].filter(Boolean).join(' · ')
    || `${game.consoleName}${discs}`;
  const art = tileArt(game);
  const [ca, cb] = CONSOLE_COLORS[game.console] || ['#3a3a3a', '#141414'];
  // Pas de barre de progression : un état de sauvegarde ne dit rien de
  // l'avancement dans le jeu, et une barre pleine se lirait comme « terminé ».
  const progress = opts.resume
    ? '<div class="card-resume">▶ Reprendre</div>' : '';

  const playIcon = game.runtime === 'native' ? '🖥' : '▶';
  // Deux couches : la jaquette floutée remplit la vignette, la jaquette nette
  // s'affiche entière par-dessus. Ni bandes noires, ni rognage.
  // La capture de gameplay se revele au survol, sous la jaquette
  const snap = game.art
    ? `<div class="card-snap" style="background-image:url(${game.art})"></div>` : '';
  const artLayers = art
    ? `<div class="card-blur" style="background-image:url(${art})"></div>
       <div class="card-art" style="background-image:url(${art})"></div>${snap}`
    : `<div class="card-art card-noart" style="background-image:linear-gradient(160deg, ${ca}, ${cb})">
         <span>${escapeHtml(game.title)}</span>
       </div>`;

  el.innerHTML = `
    ${artLayers}
    ${progress}
    <div class="card-badge">${escapeHtml(game.consoleShort)}</div>
    ${native}${excl}${multi}
    <div class="card-hover">
      <div class="card-actions">
        <button class="card-act primary" data-act="play" title="Jouer">${playIcon}</button>
        <button class="card-act" data-act="list" title="${game.inList ? 'Retirer de ma liste' : 'Ajouter à ma liste'}">${game.inList ? '✓' : '+'}</button>
        <button class="card-act" data-act="info" title="Plus d’infos">i</button>
      </div>
      <b>${escapeHtml(game.title)}</b>
      <small>${escapeHtml(sub)}</small>
    </div>`;

  // Les boutons agissent sans ouvrir la fiche : on arrête la propagation
  $$('.card-act', el).forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'play') play(game.id, { resume: Boolean(game.resume) });
      else if (act === 'info') openDetail(game.id);
      else if (act === 'list') {
        try {
          await api(`/api/games/${game.id}/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: !game.inList }),
          });
          await refresh();
          toast(game.inList ? 'Retiré de ta liste.' : 'Ajouté à ta liste.');
        } catch (err) { toast(err.message); }
      }
    });
  });

  el.addEventListener('click', () => openDetail(game.id, el));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openDetail(game.id, el);
  });
  return el;
}

/**
 * Ancre le déploiement de la fiche sur la vignette d'origine : le panneau
 * grandit depuis l'endroit que l'œil regardait.
 */
function setBloomOrigin(fromEl) {
  const panel = $('.detail-panel');
  if (!fromEl) { panel.style.removeProperty('--from-x'); panel.style.removeProperty('--from-y'); return; }
  const r = fromEl.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const x = ((r.left + r.width / 2) - p.left) / (p.width || 1) * 100;
  const y = ((r.top + r.height / 2) - p.top) / (p.height || 1) * 100;
  panel.style.setProperty('--from-x', `${Math.max(-40, Math.min(140, x))}%`);
  panel.style.setProperty('--from-y', `${Math.max(-40, Math.min(140, y))}%`);
}

function row(title, games, opts = {}) {
  if (!games.length) return null;
  const section = document.createElement('section');
  section.className = 'row';

  // En grille, les jeux d'une console tiennent sur plusieurs lignes plutot
  // que dans une rangee qui defile : on les voit tous d'un coup.
  if (opts.grille) {
    section.className = 'grille-jeux';
    for (const g of games) section.appendChild(card(g, opts));
    return section;
  }

  const h2 = document.createElement('h2');
  h2.className = 'row-title';
  h2.textContent = title;

  const viewport = document.createElement('div');
  viewport.className = 'row-viewport';

  const scroller = document.createElement('div');
  scroller.className = 'row-scroller';
  for (const g of games) scroller.appendChild(card(g, opts));

  // Flèches de pagination : un clic avance d'une largeur d'écran, comme Netflix
  const prev = document.createElement('button');
  prev.className = 'row-arrow prev';
  prev.innerHTML = '‹';
  prev.setAttribute('aria-label', 'Jeux précédents');
  const next = document.createElement('button');
  next.className = 'row-arrow next';
  next.innerHTML = '›';
  next.setAttribute('aria-label', 'Jeux suivants');

  const page = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.9, behavior: 'smooth' });
  prev.onclick = (e) => { e.stopPropagation(); page(-1); };
  next.onclick = (e) => { e.stopPropagation(); page(1); };

  /** Masque la flèche quand il n'y a rien de plus dans cette direction. */
  const updateArrows = () => {
    const max = scroller.scrollWidth - scroller.clientWidth;
    prev.disabled = scroller.scrollLeft < 8;
    next.disabled = scroller.scrollLeft >= max - 8;
  };
  scroller.addEventListener('scroll', updateArrows, { passive: true });
  // Après le premier rendu, les dimensions sont connues
  requestAnimationFrame(updateArrows);

  viewport.append(scroller, prev, next);
  section.append(h2, viewport);
  return section;
}

function render() {
  const rows = $('#rows');
  rows.textContent = '';
  const hero = $('#hero');
  const empty = $('#empty-state');

  if (!state.games.length) {
    hero.hidden = true;
    empty.hidden = false;
    $('#empty-path').textContent = state.status?.paths?.import || '';
    return;
  }
  empty.hidden = true;

  // Recherche ou filtre actif : on bascule sur une grille de résultats
  if (filtersActive()) {
    hero.hidden = true;
    $('#filters').hidden = false;
    buildFilterOptions();
    const hits = applyFilters();
    $('#f-count').textContent = `${hits.length} jeu${hits.length > 1 ? 'x' : ''}`;
    rows.appendChild(hits.length
      ? resultsGrid(hits)
      : emptyMessage('Aucun jeu ne correspond à ces critères.'));
    return;
  }
  $('#filters').hidden = true;

  if (state.view === 'mylist') {
    hero.hidden = true;
    const list = state.games.filter((g) => g.inList);
    rows.appendChild(row('Ma liste', list) || emptyMessage(
      'Ta liste est vide. C’est ton étagère à part : les jeux que tu veux '
      + 'retrouver sans fouiller le catalogue. Ajoute-les avec le bouton + '
      + 'sur une vignette ou depuis la fiche d’un jeu.',
    ));
    return;
  }

  if (state.view === 'consoles') {
    hero.hidden = true;
    // Une console choisie : on montre ses jeux. Sinon, la grille des machines.
    if (state.consoleChoisie) {
      const c = state.consoles.find((x) => x.id === state.consoleChoisie);
      rows.appendChild(enteteConsole(c));
      const r = row('', state.games.filter((g) => g.console === state.consoleChoisie), { grille: true });
      if (r) rows.appendChild(r);
    } else {
      rows.appendChild(grilleConsoles());
    }
    return;
  }

  // Accueil
  renderHero();
  // « Reprendre » ne liste que les jeux ayant une sauvegarde : un jeu
  // simplement lancé puis quitté n'a rien à reprendre
  const resume = state.games.filter((g) => g.resume)
    .sort((a, b) => (b.resume.at || 0) - (a.resume.at || 0)).slice(0, 20);
  const recent = [...state.games].sort((a, b) => b.addedAt - a.addedAt).slice(0, 20);
  const mylist = state.games.filter((g) => g.inList);

  // Classement par temps de jeu : n'apparaît qu'avec de vraies parties
  const mostPlayed = state.games
    .filter((g) => g.playSeconds >= 60)
    .sort((a, b) => b.playSeconds - a.playSeconds)
    .slice(0, 10);

  appendIf(rows, row('Reprendre la partie', resume, { resume: true }));
  appendIf(rows, rankedRow('Tes jeux les plus joués', mostPlayed));
  appendIf(rows, row('Ajoutés récemment', recent));
  appendIf(rows, row('Ma liste', mylist));

  for (const c of state.consoles) {
    if (!c.count) continue;
    appendIf(rows, row(c.name, state.games.filter((g) => g.console === c.id)));
  }
}

/**
 * Rangée numérotée, façon « Top 10 » de Netflix : un grand chiffre évidé
 * adossé à chaque vignette. N'a de sens que sur un classement réel.
 */
function rankedRow(title, games) {
  const r = row(title, games);
  if (!r) return null;
  r.classList.add('row-ranked');
  $$('.card', r).forEach((el, i) => {
    const rank = document.createElement('span');
    rank.className = 'card-rank';
    rank.textContent = String(i + 1);
    el.appendChild(rank);
  });
  return r;
}

/** Ossature affichée pendant le chargement, pour éviter la page blanche. */
function skeleton() {
  const wrap = document.createElement('div');
  wrap.className = 'skeleton';
  wrap.innerHTML = `
    <div class="sk-hero"></div>
    ${[0, 1].map(() => `
      <section class="row">
        <div class="sk-title"></div>
        <div class="row-viewport"><div class="row-scroller">
          ${Array.from({ length: 6 }, () => '<div class="sk-card"></div>').join('')}
        </div></div>
      </section>`).join('')}`;
  return wrap;
}

function appendIf(parent, el) { if (el) parent.appendChild(el); }

function emptyMessage(text) {
  const d = document.createElement('p');
  d.style.cssText = 'padding:0 var(--gutter);color:var(--text-dim)';
  d.textContent = text;
  return d;
}

/*
 * Le titre du jeu, montre plutot qu'ecrit.
 *
 * C'est la signature d'ARTFLIX, et c'est plus qu'une coquetterie : le
 * lettrage de Shenmue ou de Metal Gear se reconnait avant d'etre lu. Le
 * texte reste dans l'element — il part hors cadre — pour les lecteurs
 * d'ecran et pour les jeux dont LaunchBox n'a pas de logo.
 */
function titreDuJeu(el, game) {
  el.textContent = game.title;
  el.classList.toggle('avec-logo', Boolean(game.logo));
  el.style.backgroundImage = game.logo ? `url(${game.logo})` : '';
}

/*
 * Les candidats a la banniere : les mieux notes qui ont une illustration.
 *
 * La version precedente prenait `state.games.slice(0, 20)`. Or la liste est
 * triee par titre : c'etaient donc toujours les vingt premiers dans l'ordre
 * alphabetique. Avec 169 jeux le defaut passait inapercu ; a un millier, la
 * banniere ne proposait plus qu'« Actua Soccer 3 » et « Adidas Power Soccer »
 * a longueur de journee.
 *
 * Le seuil de note descend tant qu'il ne reste pas de quoi varier, et finit
 * par tomber a zero : une bibliotheque sans aucune note doit quand meme avoir
 * une banniere.
 */
function bassinVedettes() {
  const visuel = (g) => g.fanart || g.art || g.cover;
  for (const seuil of [4.2, 4, 3.5, 0]) {
    const p = state.games.filter((g) => visuel(g) && (g.rating ?? 0) >= seuil);
    if (p.length >= 12) return p;
  }
  return state.games.filter(visuel);
}

function renderHero(idVoulu = null) {
  const hero = $('#hero');
  const pool = bassinVedettes();
  if (!pool.length) { hero.hidden = true; return; }

  /*
   * La pile est tiree une fois, pas a chaque rendu : la banniere se redessine
   * apres le moindre changement — une partie lancee, un jeu ajoute a la liste
   * — et voir la vedette sauter a chaque fois serait insupportable.
   *
   * On y met en priorite des jeux qui ont un logo : la colonne les montre en
   * image, et un titre ecrit au milieu de six lettrages fait tache.
   */
  if (!state.heroPile.length) {
    const avecLogo = pool.filter((g) => g.logo);
    state.heroPile = [...(avecLogo.length >= 6 ? avecLogo : pool)]
      .sort(() => Math.random() - 0.5)
      .slice(0, 6)
      .map((g) => g.id);
  }

  const game = state.games.find((g) => g.id === (idVoulu ?? state.heroPile[0])) || pool[0];
  hero.hidden = false;
  hero.dataset.id = game.id;
  const bg = $('.hero-bg', hero);
  bg.style.cssText = artStyle(game);
  // Les captures d'epoque font 320x224 : agrandies, un rendu net en gros
  // pixels est plus fidele qu'un lissage flou
  bg.classList.toggle('retro', Boolean(game.art) && !game.fanart);
  marqueConsole($('.hero-console', hero), game);
  titreDuJeu($('.hero-title', hero), game);
  const bits = [game.year, game.genre, game.publisher, game.region,
    game.discs > 1 ? `${game.discs} disques` : null,
    fmtPlaytime(game.playSeconds)].filter(Boolean);
  $('.hero-meta', hero).textContent = bits.join('  ·  ');
  const desc = $('.hero-desc', hero);
  desc.textContent = game.description || '';
  desc.hidden = !game.description;
  $('.btn-play', hero).onclick = () => play(game.id);
  $('.btn-info', hero).onclick = () => openDetail(game.id);

  const pile = $('.hero-pile', hero);
  pile.innerHTML = '';
  for (const id of state.heroPile) {
    const g = state.games.find((x) => x.id === id);
    if (!g) continue;
    const el = document.createElement('button');
    el.className = 'hp-item';
    el.classList.toggle('actif', g.id === game.id);
    el.classList.toggle('avec-logo', Boolean(g.logo));
    el.style.backgroundImage = g.logo ? `url(${g.logo})` : '';
    // Le nom vit dans un element a part : sur un <button>, text-indent ne
    // suffit pas a le sortir du cadre, et il resterait lisible sous le logo.
    const nom = document.createElement('span');
    nom.className = 'hp-nom';
    nom.textContent = g.title;
    el.appendChild(nom);
    el.title = `${g.title} — ${g.consoleName}`;
    el.onclick = () => renderHero(g.id);
    pile.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------------------------------------- Fiche */

/** Ajoute ou retire un jeu de « Ma liste ». Appelee depuis la fiche et la manette. */
async function basculerListe(game) {
  await api(`/api/games/${game.id}/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: !game.inList }),
  });
  toast(game.inList ? `Retiré de ta liste — ${game.title}` : `Ajouté à ta liste — ${game.title}`);
  await refresh();
}

function openDetail(id, fromEl = null) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  const panel = $('#view-detail');
  setBloomOrigin(fromEl);
  $('.detail-art-bg', panel).style.cssText = artStyle(game);
  marqueConsole($('.detail-console', panel), game);
  titreDuJeu($('.detail-title', panel), game);

  const poster = $('.detail-poster', panel);
  poster.style.cssText = posterStyle(game);
  poster.hidden = !game.cover;
  $('.detail-grid', panel).classList.toggle('no-poster', !game.cover);

  const bits = [game.year, game.consoleName, game.genre,
    game.exclusivity ? `Exclusivité ${game.exclusivity}` : game.edition || game.region,
    game.players ? `${game.players} joueur${game.players > 1 ? 's' : ''}` : null,
    fmtSize(game.size), game.discs > 1 ? `${game.discs} disques` : null,
    game.format?.toUpperCase()].filter(Boolean);
  const played = fmtPlaytime(game.playSeconds);
  $('.detail-meta', panel).innerHTML = bits.map((b) => `<span>${escapeHtml(b)}</span>`).join('')
    + (played ? `<span><b>${escapeHtml(played)} de jeu</b></span>` : '');

  const note = $('.detail-note', panel);
  note.innerHTML = etoiles(game.rating);
  note.hidden = !game.rating;

  renderEditions(panel, game);

  const credits = [
    game.developer ? `Développé par ${game.developer}` : null,
    game.publisher && game.publisher !== game.developer ? `Édité par ${game.publisher}` : null,
    game.serial ? `Réf. ${game.serial}` : null,
  ].filter(Boolean).join('  ·  ');
  const creditsEl = $('.detail-credits', panel);
  creditsEl.textContent = credits;
  creditsEl.hidden = !credits;

  $('.detail-desc', panel).textContent = game.description
    || 'Aucun synopsis disponible pour ce jeu dans la base libretro.';

  renderScrapeState(panel, game);

  const native = $('.detail-native', panel);
  if (game.runtime === 'native') {
    native.hidden = false;
    const isFangame = game.console === 'fangamePC';
    native.innerHTML = `
      <b>Ce jeu se lance sur le PC, pas dans le navigateur.</b><br>
      ${escapeHtml(game.consoleName)} passe par ${escapeHtml(game.emulator || 'un programme externe')}.
      ${isFangame
        ? 'Un fangame est un programme à part entière : il doit être approuvé une fois avant de pouvoir être lancé.'
        : 'L’émulateur doit être enregistré une fois dans « + Ajouter des jeux ».'}
      <div class="native-actions">
        <button class="btn btn-play native-launch">Lancer sur le PC</button>
        ${isFangame ? '<button class="btn btn-ghost native-approve">Approuver ce jeu</button>' : ''}
      </div>`;

    $('.native-launch', native).onclick = () => launchNative(game);
    const approve = $('.native-approve', native);
    if (approve) approve.onclick = async () => {
      try {
        const r = await api(`/api/games/${game.id}/approve`, { method: 'POST' });
        toast(`Approuvé — empreinte ${r.approval.sha256.slice(0, 12)}…`);
      } catch (err) { toast(err.message); }
    };
  } else {
    native.hidden = true;
  }

  const playBtn = $('.detail-play', panel);
  const restartBtn = $('.detail-restart', panel);
  const isNative = game.runtime === 'native';

  // Une partie sauvegardée transforme le bouton principal en « Reprendre »,
  // et fait apparaître un second bouton pour repartir de zéro
  const canResume = Boolean(game.resume) && game.runtime === 'web';
  $('.play-label', playBtn).textContent = isNative
    ? 'Lancer sur le PC'
    : (canResume ? 'Reprendre' : 'Jouer');
  playBtn.disabled = false;
  playBtn.style.opacity = 1;
  playBtn.onclick = () => (isNative
    ? launchNative(game)
    : play(game.id, { resume: canResume }));
  restartBtn.hidden = !canResume;
  restartBtn.onclick = () => play(game.id, { resume: false });

  renderShots(panel, game);
  renderSaves(panel, game);

  const listBtn = $('.detail-list', panel);
  listBtn.classList.toggle('on', game.inList);
  listBtn.textContent = game.inList ? '✓' : '+';
  listBtn.onclick = async () => {
    await basculerListe(game);
    openDetail(game.id);
  };

  panel.hidden = false;
}

/* -------------------------------------------- Mode TV et navigation manette */

/*
 * Navigation à la manette pour le canapé.
 *
 * On n'écoute la manette QUE hors partie : pendant le jeu, elle appartient à
 * l'émulateur, et intercepter ses appuis ferait bouger le catalogue derrière.
 */
const pad = {
  on: false,
  raf: null,
  last: 0,
  pressed: new Set(),
};

const PAD_REPEAT_MS = 180;

function cards() {
  return $$('.card').filter((c) => c.offsetParent !== null);
}

function focusCard(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

/** Déplace le focus dans la grille : horizontalement dans une rangée,
 *  verticalement vers la rangée voisine à position comparable. */
function moveFocus(dx, dy) {
  const all = cards();
  if (!all.length) return;
  const current = document.activeElement?.classList?.contains('card')
    ? document.activeElement : null;
  if (!current) { focusCard(all[0]); return; }

  if (dx) {
    const row = [...current.parentElement.children].filter((c) => c.classList.contains('card'));
    const i = row.indexOf(current);
    focusCard(row[i + dx] || current);
    return;
  }
  if (dy) {
    const rows = $$('.row-scroller').filter((r) => r.offsetParent !== null);
    const rowIndex = rows.findIndex((r) => r.contains(current));
    const target = rows[rowIndex + dy];
    if (!target) return;
    const row = [...current.parentElement.children].filter((c) => c.classList.contains('card'));
    const pos = row.indexOf(current);
    const next = [...target.children].filter((c) => c.classList.contains('card'));
    focusCard(next[Math.min(pos, next.length - 1)]);
  }
}

function padTick() {
  pad.raf = requestAnimationFrame(padTick);

  // Pendant une partie, la manette est au jeu
  if (!$('#view-player').hidden) return;

  const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (!gp) return;

  const now = performance.now();
  const axisX = gp.axes[0] || 0;
  const axisY = gp.axes[1] || 0;
  const held = {
    left: gp.buttons[14]?.pressed || axisX < -0.5,
    right: gp.buttons[15]?.pressed || axisX > 0.5,
    up: gp.buttons[12]?.pressed || axisY < -0.5,
    down: gp.buttons[13]?.pressed || axisY > 0.5,
  };

  if (now - pad.last > PAD_REPEAT_MS) {
    if (held.left) { moveFocus(-1, 0); pad.last = now; }
    else if (held.right) { moveFocus(1, 0); pad.last = now; }
    else if (held.up) { moveFocus(0, -1); pad.last = now; }
    else if (held.down) { moveFocus(0, 1); pad.last = now; }
  }

  // Boutons d'action : on n'agit qu'au front montant
  const press = (index) => {
    const down = gp.buttons[index]?.pressed;
    const was = pad.pressed.has(index);
    if (down && !was) { pad.pressed.add(index); return true; }
    if (!down && was) pad.pressed.delete(index);
    return false;
  };

  if (press(0)) {
    const el = document.activeElement;
    if (el?.classList?.contains('card')) el.click();
    else $('.detail-play')?.click();
  }
  if (press(1)) {
    // B : refermer le panneau ouvert, comme Échap
    if (!$('#view-detail').hidden) $('#view-detail').hidden = true;
  }
  if (press(2)) {
    // X : « Ma liste », sur le jeu sous le curseur
    const el = document.activeElement;
    const jeu = state.games.find((g) => String(g.id) === el?.dataset?.id);
    if (jeu) basculerListe(jeu).then(() => focusCard(cards()
      .find((c) => c.dataset.id === String(jeu.id))));
  }
  if (press(3)) randomGame();            // Y : un jeu au hasard
  if (press(9)) {                        // Start : la grille des consoles
    state.consoleChoisie = null;
    setView('consoles');
  }
}

/*
 * L'heure en pied d'ecran.
 *
 * Une console de salon l'affiche toujours : branche sur la television, le
 * site occupe tout l'ecran et c'est la seule horloge visible de la piece.
 */
let horlogeTv = null;

function majHeure() {
  const el = $('#aide-heure');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function setTvMode(on) {
  pad.on = on;
  document.body.classList.toggle('tv', on);
  $('#nav-tv').textContent = on ? 'Quitter le mode TV' : 'Mode TV';
  $('#aide-tv').hidden = !on;
  clearInterval(horlogeTv);
  horlogeTv = null;
  if (on) { majHeure(); horlogeTv = setInterval(majHeure, 20000); }

  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {
      // Le plein écran peut être refusé s'il n'y a pas eu de geste utilisateur
    });
    if (!pad.raf) padTick();
    focusCard(cards()[0]);
    toast('Mode TV — navigation à la manette ou aux flèches.');
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    cancelAnimationFrame(pad.raf);
    pad.raf = null;
  }
}

/* ------------------------------------------------------------ Commandes */

/** Noms lisibles des touches, pour les codes qui n'ont pas de caractère. */
const KEY_NAMES = {
  8: '⌫', 9: '⇥', 13: '⏎ Entrée', 16: '⇧ Maj', 17: 'Ctrl', 18: 'Alt',
  27: 'Échap', 32: '␣ Espace', 37: '←', 38: '↑', 39: '→', 40: '↓',
  45: 'Inser', 46: 'Suppr', 96: 'Pavé 0', 97: 'Pavé 1', 98: 'Pavé 2',
  99: 'Pavé 3', 100: 'Pavé 4', 101: 'Pavé 5', 102: 'Pavé 6',
};

function keyName(code) {
  if (code == null) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code >= 48 && code <= 90) return String.fromCharCode(code);
  if (code >= 112 && code <= 123) return `F${code - 111}`;
  return `#${code}`;
}

const ctrlState = { console: null, profile: null, layout: [], listening: null };

async function openControls(consoleId = null) {
  const modal = $('#view-controls');
  modal.hidden = false;

  let consoles;
  try { consoles = await api('/api/controls'); } catch { consoles = []; }

  if (!consoles.length) {
    $('#ctrl-consoles').innerHTML = '';
    $('#ctrl-grid').innerHTML = '';
    $('#ctrl-hint').textContent =
      'Aucune console jouable dans le navigateur au catalogue pour le moment.';
    return;
  }

  // Le point signale un profil personnalisé ; les consoles sans jeu restent
  // configurables, mais s'affichent en retrait
  $('#ctrl-consoles').innerHTML = consoles.map((c) => `
    <button class="ctrl-console${c.games ? '' : ' empty'}" data-id="${c.id}"
            title="${c.games ? `${c.games} jeu(x)` : 'Aucun jeu pour le moment'}">
      ${escapeHtml(c.name)}${c.customized ? ' •' : ''}
    </button>`).join('');

  $$('.ctrl-console').forEach((el) => {
    el.onclick = () => loadControls(el.dataset.id);
  });

  await loadControls(consoleId && consoles.some((c) => c.id === consoleId)
    ? consoleId : consoles[0].id);
}

async function loadControls(consoleId) {
  let data;
  try { data = await api(`/api/controls/${consoleId}`); } catch (err) { toast(err.message); return; }

  ctrlState.console = consoleId;
  ctrlState.profile = data.profile;
  ctrlState.layout = data.layout;
  ctrlState.listening = null;

  $$('.ctrl-console').forEach((el) => {
    el.classList.toggle('on', el.dataset.id === consoleId);
  });
  $('#ctrl-hint').innerHTML =
    `<b>${escapeHtml(data.name)}</b> — clique sur un bouton puis appuie sur la touche à lui donner. `
    + `Une manette branchée est reconnue automatiquement par l'émulateur.`;
  drawControls();
  loadVideo(consoleId);
}

/* --------------------------------------------------------- Rendu de l'image */

/** Shader et mise à l'échelle, réglés par console comme les commandes. */
async function loadVideo(consoleId) {
  let v;
  try { v = await api(`/api/video/${consoleId}`); } catch { return; }

  const sel = $('#vid-shader');
  // Les shaders sont regroupés par intention : télé cathodique, lissage, direct
  const groups = [...new Set(v.shaders.map((s) => s.group))];
  sel.innerHTML = groups.map((g) => {
    const opts = v.shaders.filter((s) => s.group === g)
      .map((s) => `<option value="${escapeHtml(s.id)}"${s.id === v.shader ? ' selected' : ''}>${escapeHtml(s.name)}</option>`)
      .join('');
    return `<optgroup label="${escapeHtml(g)}">${opts}</optgroup>`;
  }).join('');

  $('#vid-desc').textContent = v.pixelated
    ? 'Pixels nets par défaut. Un shader CRT imite une télé cathodique de l’époque.'
    : 'Console 3D : le lissage est conservé. Un shader CRT reste possible.';

  sel.onchange = async () => {
    try {
      await api(`/api/video/${consoleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shader: sel.value }),
      });
      const nom = sel.options[sel.selectedIndex].textContent;
      toast(`Rendu « ${nom} » — actif au prochain lancement.`);
    } catch (err) { toast(err.message); }
  };
}

function drawControls() {
  const grid = $('#ctrl-grid');
  const p1 = ctrlState.profile[0] || {};
  grid.innerHTML = ctrlState.layout.map((b) => {
    const bound = p1[b.index];
    const listening = ctrlState.listening === b.index;
    return `
      <button class="ctrl-key${listening ? ' listening' : ''}${b.direction ? ' dir' : ''}"
              data-index="${b.index}">
        <span class="ctrl-label">${escapeHtml(b.label)}</span>
        <span class="ctrl-value">${listening ? 'Appuie…' : escapeHtml(keyName(bound?.value))}</span>
      </button>`;
  }).join('');

  $$('.ctrl-key', grid).forEach((el) => {
    el.onclick = () => {
      ctrlState.listening = Number(el.dataset.index);
      drawControls();
    };
  });
}

/** Capture la prochaine touche pressée et l'affecte au bouton en écoute. */
function captureKey(e) {
  if (ctrlState.listening === null || $('#view-controls').hidden) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') { ctrlState.listening = null; drawControls(); return; }

  const index = ctrlState.listening;
  const existing = ctrlState.profile[0][index] || {};
  ctrlState.profile[0][index] = { ...existing, value: e.keyCode };

  // Une même touche ne peut pas servir deux boutons : on libère l'ancien
  for (const [key, binding] of Object.entries(ctrlState.profile[0])) {
    if (Number(key) !== index && binding.value === e.keyCode) delete binding.value;
  }

  ctrlState.listening = null;
  drawControls();
}

async function saveControls() {
  try {
    await api(`/api/controls/${ctrlState.console}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: ctrlState.profile }),
    });
    toast('Commandes enregistrées pour cette console.');
    await loadControls(ctrlState.console);
  } catch (err) { toast(err.message); }
}

/* --------------------------------------------------- Émulateurs natifs */

const EMU_STATE = {
  ready:   { label: 'Prêt',                  cls: 'conf-high' },
  absent:  { label: 'Non enregistré',        cls: 'conf-low' },
  missing: { label: 'Fichier introuvable',   cls: 'conf-low' },
  changed: { label: 'Binaire modifié',       cls: 'conf-medium' },
};

async function loadEmulators() {
  const box = $('#emulators');
  let data;
  try { data = await api('/api/emulators'); } catch { return; }

  // Le compte vit sur l'onglet : c'est là qu'on le cherche du regard
  const ready = data.emulators.filter((e) => e.state === 'ready').length;
  const tab = $('.mtab[data-tab="emu"]');
  if (tab) tab.textContent = ready ? `Émulateurs (${ready})` : 'Émulateurs';

  // Chaque émulateur tient sur une ligne ; le champ de saisie n'apparaît
  // qu'au moment de configurer, pour ne pas transformer l'écran en formulaire.
  box.innerHTML = data.emulators.map((e) => {
    const st = EMU_STATE[e.state] || EMU_STATE.absent;
    const warn = e.state === 'changed'
      ? `<div class="emu-warn">Le binaire a changé depuis son approbation. Vérifie qu’il s’agit bien d’une mise à jour, puis réenregistre-le.</div>`
      : '';
    const sub = e.path
      ? `<span class="emu-path">${escapeHtml(e.path)}</span>`
      : `<a href="${escapeHtml(e.source)}" target="_blank" rel="noopener noreferrer">Télécharger depuis le site officiel</a>`;

    return `
      <div class="srow emu-item" data-id="${e.id}">
        <div class="srow-main">
          <b>${escapeHtml(e.name)} <span class="conf ${st.cls}">${st.label}</span></b>
          <small>${escapeHtml(e.consoleName || '')} · ${escapeHtml(e.license)}${e.note ? ` — ${escapeHtml(e.note)}` : ''}</small>
          <small>${sub}</small>
          ${warn}
          <div class="emu-edit" hidden>
            <input class="emu-input" type="text" value="${escapeHtml(e.path || '')}"
              placeholder="Chemin de ${escapeHtml(e.binaries[0])}">
            <button class="btn btn-ghost emu-save">Enregistrer</button>
          </div>
        </div>
        <div class="srow-act">
          <button class="link-btn emu-toggle">${e.path ? 'Modifier' : 'Configurer'}</button>
          ${e.path ? '<button class="link-btn emu-drop">Retirer</button>' : ''}
        </div>
      </div>`;
  }).join('');

  $$('.emu-item', box).forEach((el) => {
    const id = el.dataset.id;
    const edit = $('.emu-edit', el);

    $('.emu-toggle', el).onclick = () => {
      edit.hidden = !edit.hidden;
      if (!edit.hidden) $('.emu-input', el).focus();
    };

    const save = async () => {
      const value = $('.emu-input', el).value.trim();
      if (!value) { toast('Indique le chemin de l’exécutable.'); return; }
      try {
        await api(`/api/emulators/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: value }),
        });
        await loadEmulators();
        toast('Émulateur enregistré, empreinte relevée.');
      } catch (err) { toast(err.message); }
    };
    $('.emu-save', el).onclick = save;
    $('.emu-input', el).onkeydown = (e) => { if (e.key === 'Enter') save(); };

    const drop = $('.emu-drop', el);
    if (drop) drop.onclick = async () => {
      await api(`/api/emulators/${id}`, { method: 'DELETE' });
      await loadEmulators();
      toast('Émulateur retiré.');
    };
  });
}

/** Lance un jeu natif, en guidant vers l'action manquante le cas échéant. */
async function launchNative(game) {
  try {
    const r = await api(`/api/games/${game.id}/launch`, { method: 'POST' });
    toast(`${game.title} lancé sur le PC (${r.exec}).`);
    await refresh();
  } catch (err) {
    const msg = String(err.message || '');
    if (/n’est pas encore enregistré|pas encore enregistré/.test(msg)) {
      toast(`${msg} — ouvre « + Ajouter des jeux » pour l’enregistrer.`);
    } else if (/approuvé/.test(msg)) {
      toast(msg);
    } else {
      toast(msg);
    }
  }
}


/* ------------------------------------------------------------- Filtres */

/** Un filtre est actif des qu'un critere ou une recherche est renseigne. */
function filtersActive() {
  const f = state.filters;
  return Boolean(state.query.trim() || f.console || f.genre || f.year || f.players);
}

/** Remplit les listes deroulantes a partir du contenu reel de la bibliotheque. */
function buildFilterOptions() {
  const g = state.games;
  const uniq = (vals) => [...new Set(vals.filter(Boolean))];

  const consoles = uniq(g.map((x) => x.console))
    .map((id) => ({ v: id, t: g.find((x) => x.console === id).consoleName }))
    .sort((a, b) => a.t.localeCompare(b.t));
  const genres = uniq(g.map((x) => x.genre)).sort();
  // Les années sont regroupées par décennie : filtrer sur « 1993 » n'aurait
  // pas de sens sur une collection de cette taille.
  const decades = uniq(g.map((x) => (x.year ? `${Math.floor(x.year / 10) * 10}` : null))).sort();
  const players = uniq(g.map((x) => x.players)).sort((a, b) => a - b);

  const fill = (el, items, label) => {
    el.innerHTML = `<option value="">${label}</option>`
      + items.map((i) => `<option value="${escapeHtml(i.v ?? i)}">${escapeHtml(i.t ?? i)}</option>`).join('');
  };
  fill($('#f-console'), consoles, 'Toutes les consoles');
  fill($('#f-genre'), genres, 'Tous les genres');
  fill($('#f-year'), decades.map((d) => ({ v: d, t: `Années ${d}` })), 'Toutes les années');
  fill($('#f-players'), players.map((p) => ({ v: p, t: `${p} joueur${p > 1 ? 's' : ''}` })), 'Tous');

  for (const [key, el] of Object.entries({
    console: $('#f-console'), genre: $('#f-genre'), year: $('#f-year'), players: $('#f-players'),
  })) {
    el.value = state.filters[key] || '';
    el.classList.toggle('on', Boolean(state.filters[key]));
  }
  $('#f-sort').value = state.filters.sort;
}

/** Applique recherche, filtres et tri. */
function applyFilters() {
  const f = state.filters;
  const q = state.query.trim().toLowerCase();

  let out = state.games.filter((g) => {
    if (q && !`${g.title} ${g.consoleName} ${g.genre || ''} ${g.publisher || ''}`.toLowerCase().includes(q)) return false;
    if (f.console && g.console !== f.console) return false;
    if (f.genre && g.genre !== f.genre) return false;
    if (f.players && String(g.players) !== f.players) return false;
    if (f.year) {
      const d = Number(f.year);
      if (!g.year || g.year < d || g.year > d + 9) return false;
    }
    return true;
  });

  const by = {
    title: (a, b) => a.title.localeCompare(b.title),
    added: (a, b) => b.addedAt - a.addedAt,
    // Un jeu sans année part à la fin plutôt qu'en tête
    year: (a, b) => (b.year || 0) - (a.year || 0),
    played: (a, b) => b.playSeconds - a.playSeconds,
  };
  out = out.sort(by[f.sort] || by.title);
  return out;
}

/** Grille de résultats : on parcourt une liste, on ne feuillette pas une rangée. */
function resultsGrid(games) {
  const grid = document.createElement('div');
  grid.className = 'grid-results';
  for (const g of games) grid.appendChild(card(g));
  return grid;
}



/** Résumé des sauvegardes existantes, dans l'onglet Bibliothèque. */
async function loadBackups() {
  let d;
  try { d = await api('/api/backup'); } catch { return; }
  const el = $('#backup-info');
  if (!d.sauvegardes.length) {
    el.textContent = 'Aucune sauvegarde. Catalogue, parties, temps de jeu et réglages — pas les fichiers de jeu.';
    return;
  }
  const last = d.sauvegardes[0];
  el.textContent = `${d.sauvegardes.length} sauvegarde(s) · dernière ${fmtWhen(last.at)} (${fmtSize(last.size)}) · ${d.dossier}`;
}


/* ------------------------------------------------------ Captures d'écran */

/** Demande une capture au lecteur et attend sa confirmation. */
async function takeShot() {
  const frame = $('#player-frame');
  if (state.playing == null || !frame.contentWindow) return;

  const ok = await new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data?.type !== 'dimstorted:shot-done') return;
      removeEventListener('message', onMsg);
      resolve(Boolean(e.data.ok));
    };
    addEventListener('message', onMsg);
    frame.contentWindow.postMessage({ type: 'dimstorted:shot' }, '*');
    setTimeout(() => { removeEventListener('message', onMsg); resolve(false); }, 6000);
  });

  toast(ok ? '📸 Capture enregistrée.' : 'Capture impossible.');
  if (ok) await refresh();
}

/** Galerie des captures d'un jeu, sur sa fiche. */
async function renderShots(panel, game) {
  const box = $('.detail-shots', panel);
  let list;
  try { list = await api(`/api/games/${game.id}/shots`); } catch { box.hidden = true; return; }
  if (!list.length) { box.hidden = true; return; }

  box.hidden = false;
  box.innerHTML = `
    <div class="ed-title">Tes captures <span class="shot-n">${list.length}</span></div>
    <div class="shot-strip">
      ${list.slice(0, 12).map((s) => `
        <div class="shot" data-id="${s.id}">
          <img src="${escapeHtml(s.url)}" alt="" loading="lazy">
          <div class="shot-acts">
            <button class="shot-cover" title="Utiliser comme jaquette">★</button>
            <button class="shot-del" title="Supprimer">✕</button>
          </div>
        </div>`).join('')}
    </div>`;

  $$('.shot', box).forEach((el) => {
    const id = Number(el.dataset.id);
    $('.shot-cover', el).onclick = async (e) => {
      e.stopPropagation();
      try {
        await api(`/api/shots/${id}/cover`, { method: 'POST' });
        await refresh();
        openDetail(game.id);
        toast('Capture définie comme jaquette.');
      } catch (err) { toast(err.message); }
    };
    $('.shot-del', el).onclick = async (e) => {
      e.stopPropagation();
      await api(`/api/shots/${id}`, { method: 'DELETE' });
      await refresh();
      openDetail(game.id);
    };
  });
}

/* --------------------------------------------------------- Statistiques */

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
}

function fmtLong(seconds) {
  if (!seconds) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m}` : `${h} h`;
}

/**
 * Tableau de bord : tout est calculé à partir de ce que Dimstorted collecte
 * déjà — temps de jeu, dates, consoles. Aucune donnée supplémentaire.
 */
function openStats() {
  const g = state.games;
  const joues = g.filter((x) => x.playSeconds >= 60);
  const total = g.reduce((s, x) => s + x.playSeconds, 0);
  const dates = g.map((x) => x.lastPlayed).filter(Boolean);
  const taille = g.reduce((s, x) => s + (x.size || 0), 0);

  // Répartition du temps par console
  const parConsole = [...g.reduce((m, x) => {
    if (x.playSeconds < 60) return m;
    m.set(x.consoleName, (m.get(x.consoleName) || 0) + x.playSeconds);
    return m;
  }, new Map())].sort((a, b) => b[1] - a[1]);
  const maxConsole = parConsole.length ? parConsole[0][1] : 1;

  const top = [...joues].sort((a, b) => b.playSeconds - a.playSeconds).slice(0, 8);

  $('#stats-body').innerHTML = `
    <div class="stat-top">
      <div class="stat-tile"><b>${g.length}</b><small>jeux</small></div>
      <div class="stat-tile"><b>${new Set(g.map((x) => x.console)).size}</b><small>consoles</small></div>
      <div class="stat-tile"><b>${fmtLong(total)}</b><small>de jeu au total</small></div>
      <div class="stat-tile"><b>${fmtSize(taille) || '—'}</b><small>sur le disque</small></div>
    </div>

    ${dates.length ? `<p class="fixer-hint">Dernière partie : ${escapeHtml(fmtDate(Math.max(...dates)))}
       · première : ${escapeHtml(fmtDate(Math.min(...dates)))}</p>` : ''}

    ${top.length ? `
      <div class="stat-list">
        <div class="ed-title">Tes jeux les plus joués</div>
        ${top.map((x) => `
          <div class="stat-line">
            <span class="nom">${escapeHtml(x.title)}</span>
            <span class="val">${escapeHtml(fmtLong(x.playSeconds))}</span>
          </div>`).join('')}
      </div>` : '<p class="fixer-hint">Aucune partie de plus d’une minute pour le moment — reviens après avoir joué.</p>'}

    ${parConsole.length ? `
      <div class="stat-list">
        <div class="ed-title">Temps par console</div>
        ${parConsole.map(([nom, sec]) => `
          <div class="stat-line">
            <span class="nom">${escapeHtml(nom)}</span>
            <span class="stat-bar"><i style="width:${Math.round((sec / maxConsole) * 100)}%"></i></span>
            <span class="val">${escapeHtml(fmtLong(sec))}</span>
          </div>`).join('')}
      </div>` : ''}`;

  $('#view-stats').hidden = false;
}

/* ------------------------------------------------------- Jeu au hasard */

/**
 * Tire un jeu jouable dans le navigateur et le lance.
 * On exclut le natif : ouvrir un émulateur PC sur un coup de dé serait
 * plus surprenant qu'agréable.
 */
function randomGame() {
  const pool = state.games.filter((g) => g.runtime === 'web' || g.runtime === 'html5');
  if (!pool.length) { toast('Aucun jeu jouable dans le navigateur.'); return; }
  const g = pool[Math.floor(Math.random() * pool.length)];
  toast(`🎲 ${g.title} — ${g.consoleName}`);
  play(g.id, { resume: Boolean(g.resume) });
}

/* ------------------------------------------------- Sauvegardes d'état */

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = Date.now();
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function renderSaves(panel, game) {
  const box = $('.detail-saves', panel);
  if (game.runtime !== 'web') { box.hidden = true; return; }

  let list;
  try { list = await api(`/api/games/${game.id}/saves`); } catch { box.hidden = true; return; }
  if (!list.length) { box.hidden = true; return; }

  box.hidden = false;
  const auto = list.find((s) => s.slot === 0);
  const manual = list.filter((s) => s.slot > 0);

  box.innerHTML = `
    <div class="ed-title">Sauvegardes</div>
    <div class="save-list">
      ${auto ? saveChip(auto, 'Reprise automatique') : ''}
      ${manual.map((s) => saveChip(s, `Emplacement ${s.slot}`)).join('')}
    </div>`;

  $$('.save-item', box).forEach((el) => {
    const slot = Number(el.dataset.slot);
    $('.save-load', el).onclick = () => {
      $('#view-detail').hidden = true;
      play(game.id, { resume: slot === 0 });
      if (slot > 0) {
        // Un emplacement manuel se charge une fois l'émulateur en route
        const frame = $('#player-frame');
        const onReady = (e) => {
          if (e.data?.type !== 'dimstorted:ready') return;
          removeEventListener('message', onReady);
          frame.contentWindow.postMessage({ type: 'dimstorted:load-slot', slot }, '*');
        };
        addEventListener('message', onReady);
      }
    };
    $('.save-drop', el).onclick = async () => {
      await api(`/api/games/${game.id}/saves/${slot}`, { method: 'DELETE' });
      await refresh();
      openDetail(game.id);
      toast(slot === 0 ? 'Reprise effacée.' : `Emplacement ${slot} effacé.`);
    };
  });
}

function saveChip(save, label) {
  const shot = save.shot
    ? `<img src="${escapeHtml(save.shot)}" alt="" loading="lazy">`
    : '<div class="save-noshot">—</div>';
  return `
    <div class="save-item" data-slot="${save.slot}">
      <button class="save-load">
        ${shot}
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(fmtWhen(save.created_at))}</small>
      </button>
      <button class="save-drop" title="Effacer">✕</button>
    </div>`;
}

/* ------------------------------------------------- Éditions régionales */

const REGION_FLAG = {
  France: '🇫🇷', Europe: '🇪🇺', Monde: '🌍', USA: '🇺🇸',
  Japon: '🇯🇵', Allemagne: '🇩🇪', Espagne: '🇪🇸', Italie: '🇮🇹',
  Brésil: '🇧🇷', Corée: '🇰🇷', Australie: '🇦🇺', Inconnue: '❔',
};

function flag(region) {
  return REGION_FLAG[region] || '🏳️';
}

function renderEditions(panel, game) {
  const box = $('.detail-editions', panel);
  if (!game.editions || game.editions.length < 2) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `
    <div class="ed-title">Éditions disponibles</div>
    <div class="ed-list">
      ${game.editions.map((e) => `
        <div class="ed-item${e.preferred ? ' on' : ''}" data-region="${escapeHtml(e.region)}">
          <button class="ed-pick">
            <span class="ed-flag">${flag(e.region)}</span>
            <span>${escapeHtml(e.region)}</span>
            <small>${e.discs > 1 ? `${e.discs} disques · ` : ''}${fmtSize(e.size)}</small>
          </button>
          <button class="ed-drop" title="Retirer cette édition">✕</button>
        </div>`).join('')}
    </div>`;

  $$('.ed-item', box).forEach((el) => {
    const region = el.dataset.region;
    $('.ed-pick', el).onclick = async () => {
      try {
        await api(`/api/games/${game.id}/edition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ region }),
        });
        await refresh();
        openDetail(game.id);
        toast(`Édition ${region} sélectionnée.`);
      } catch (err) { toast(err.message); }
    };
    $('.ed-drop', el).onclick = () => confirmDropEdition(game, region);
  });
}

function confirmDropEdition(game, region) {
  const modal = $('#view-confirm');
  $('.confirm-text', modal).innerHTML =
    `Retirer l’édition <b>${escapeHtml(region)}</b> de « ${escapeHtml(game.title)} » ?`;
  $('#confirm-delete-files').checked = false;
  modal.hidden = false;

  $('#confirm-cancel').onclick = () => { modal.hidden = true; };
  $('#confirm-ok').onclick = async () => {
    const withFiles = $('#confirm-delete-files').checked ? '?deleteFiles=1' : '';
    try {
      const r = await api(
        `/api/games/${game.id}/edition/${encodeURIComponent(region)}${withFiles}`,
        { method: 'DELETE' },
      );
      modal.hidden = true;
      await refresh();
      openDetail(game.id);
      toast(r.deletedFromDisk
        ? `Édition ${region} retirée et ${r.removed.length} fichier(s) supprimé(s).`
        : `Édition ${region} retirée du catalogue (fichiers conservés).`);
    } catch (err) { toast(err.message); }
  };
}

async function loadDuplicates() {
  const box = $('#duplicates');
  let data;
  try { data = await api('/api/duplicates'); } catch { return; }

  // Un badge à zéro n'apporte rien : on le retire plutôt que d'afficher « 0 »
  const dupPill = $('#dup-count');
  dupPill.textContent = data.games.length;
  dupPill.hidden = !data.games.length;
  state.regionPreference = data.preference;
  $('#region-chips').innerHTML = data.preference
    .map((r) => `<span class="region-chip">${flag(r)} ${escapeHtml(r)}</span>`).join('');

  if (!data.games.length) { box.innerHTML = ''; return; }
  box.innerHTML = data.games.map((g) => `
    <div class="dup-item">
      <div>
        <b>${escapeHtml(g.title)}</b>
        <small>${escapeHtml(g.consoleShort)}</small>
      </div>
      <div class="dup-regions">
        ${g.editions.map((e) => `<span class="dup-chip${e.preferred ? ' on' : ''}">${flag(e.region)} ${escapeHtml(e.region)}</span>`).join('')}
      </div>
      <button class="btn btn-ghost dup-open" data-id="${g.id}">Arbitrer</button>
    </div>`).join('');

  $$('.dup-open', box).forEach((btn) => {
    btn.onclick = () => {
      $('#view-import').hidden = true;
      openDetail(Number(btn.dataset.id));
    };
  });
}

/** Fichiers écartés parce qu'ils faisaient doublon — ils occupent encore le disque. */
async function loadRejected() {
  const box = $('#rejected');
  let items;
  try { items = await api('/api/import/duplicates'); } catch { return; }

  $('#rejected-row').hidden = !items.length;
  if (!items.length) { box.hidden = true; return; }
  const total = items.reduce((s, i) => s + (i.size || 0), 0);
  const dup = items.filter((i) => i.kind === 'duplicate').length;
  const arc = items.filter((i) => i.kind === 'archive').length;

  const why = [
    dup ? `${dup} doublon${dup > 1 ? 's' : ''} déjà au catalogue` : null,
    arc ? `${arc} archive${arc > 1 ? 's' : ''} déjà décompressée${arc > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  box.hidden = false;
  box.innerHTML = `
    <div class="rejected-note">
      <span>
        <b>${items.length} fichier(s) devenus inutiles</b> — ${escapeHtml(why)}.
        ${fmtSize(total)} occupés dans le dossier Import.
      </span>
      <button class="btn btn-ghost" id="btn-purge">Supprimer ces fichiers</button>
    </div>
    <ul class="rejected-list">
      ${items.slice(0, 8).map((i) => `<li>${i.kind === 'archive' ? '🗜 ' : ''}${escapeHtml(i.file)}</li>`).join('')}
      ${items.length > 8 ? `<li>… et ${items.length - 8} autre(s)</li>` : ''}
    </ul>`;

  $('#btn-purge').onclick = async () => {
    const r = await api('/api/import/duplicates/purge', { method: 'POST' });
    toast(`${r.removed.length} fichier(s) supprimé(s).`
      + (r.failed.length ? ` ${r.failed.length} en échec.` : ''));
    await loadRejected();
    await loadQueue();
  };
}

/* --------------------------------------------- Correction des jaquettes */

const SCRAPE_LABEL = {
  ok: null, // rien a signaler
  uncertain: 'Correspondance incertaine — vérifie que la jaquette est la bonne.',
  notfound: 'Aucune jaquette trouvée automatiquement.',
  none: 'Pas encore de jaquette.',
  manual: null, // fangame : aucune base ne le connait, tout se saisit a la main
};

function renderScrapeState(panel, game) {
  const box = $('.detail-scrape', panel);
  const fanmade = game.scrapeStatus === 'manual';

  if (fanmade) {
    // Aucune base ne référence les fangames : la saisie manuelle est la
    // seule voie, autant la mettre en avant plutôt que de proposer une
    // recherche qui ne donnera rien.
    box.innerHTML = `
      <div class="scrape-note">
        <span>Fangame ou homebrew — aucune base ne le référence. Les infos se saisissent à la main.</span>
        <button class="btn btn-ghost edit-btn">Modifier la fiche</button>
      </div>`;
    $('.edit-btn', box).onclick = () => openEditor(game);
    return;
  }

  const label = SCRAPE_LABEL[game.scrapeStatus];
  if (!label) {
    box.innerHTML = `
      <button class="link-btn fix-btn">Ce n’est pas la bonne jaquette ?</button>
      <button class="link-btn edit-btn">Modifier la fiche</button>`;
  } else {
    box.innerHTML = `
      <div class="scrape-note">
        <span>${escapeHtml(label)}</span>
        <span class="scrape-note-actions">
          <button class="btn btn-ghost fix-btn">Chercher la jaquette</button>
          <button class="btn btn-ghost edit-btn">Saisir à la main</button>
        </span>
      </div>`;
  }
  $('.fix-btn', box).onclick = () => openFixer(game);
  $('.edit-btn', box).onclick = () => openEditor(game);
}

/* ---------------------------------------------------- Édition manuelle */

let editorGame = null;
let editorCover = null;

function openEditor(game) {
  editorGame = game;
  editorCover = null;
  const modal = $('#view-edit');
  $('.edit-game', modal).textContent = `${game.title} — ${game.consoleName}`;
  $('#edit-title').value = game.title || '';
  $('#edit-year').value = game.year || '';
  $('#edit-genre').value = game.genre || '';
  $('#edit-players').value = game.players || '';
  $('#edit-developer').value = game.developer || '';
  $('#edit-publisher').value = game.publisher || '';
  $('#edit-description').value = game.description || '';
  $('#edit-cover-name').textContent = '';
  $('#view-detail').hidden = true;
  modal.hidden = false;
  $('#edit-title').focus();
}

function closeEditor() {
  $('#view-edit').hidden = true;
  if (editorGame) {
    openDetail(editorGame.id);
    editorGame = null;
  }
}

async function saveEditor() {
  if (!editorGame) return;
  const id = editorGame.id;
  const body = {
    title: $('#edit-title').value,
    year: $('#edit-year').value,
    genre: $('#edit-genre').value,
    players: $('#edit-players').value,
    developer: $('#edit-developer').value,
    publisher: $('#edit-publisher').value,
    description: $('#edit-description').value,
  };
  try {
    await api(`/api/games/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (editorCover) {
      const form = new FormData();
      form.append('cover', editorCover);
      const res = await fetch(`/api/games/${id}/cover`, { method: 'POST', body: form });
      if (!res.ok) throw new Error('Envoi de la jaquette impossible');
    }
    await refresh();
    $('#view-edit').hidden = true;
    editorGame = null;
    openDetail(id);
    toast('Fiche mise à jour.');
  } catch (err) {
    toast(err.message);
  }
}

/** Jeu dont la fiche doit être rouverte quand le correcteur se referme. */
let fixerReturnTo = null;

async function openFixer(game) {
  const modal = $('#view-fixer');
  $('.fixer-game', modal).textContent = `${game.title} — ${game.consoleName}`;
  const input = $('#fixer-input');
  input.value = game.title;
  // On masque la fiche : deux panneaux superposés feraient apparaître
  // deux boutons de fermeture concurrents
  fixerReturnTo = game.id;
  $('#view-detail').hidden = true;
  modal.hidden = false;
  input.focus();
  await runFixerSearch(game);

  $('#fixer-search').onclick = () => runFixerSearch(game);
  input.onkeydown = (e) => { if (e.key === 'Enter') runFixerSearch(game); };
}

/** Referme le correcteur et rouvre la fiche d'où l'on venait. */
function closeFixer() {
  $('#view-fixer').hidden = true;
  if (fixerReturnTo !== null) {
    openDetail(fixerReturnTo);
    fixerReturnTo = null;
  }
}

async function runFixerSearch(game) {
  const results = $('#fixer-results');
  results.innerHTML = '<p class="fixer-hint">Recherche…</p>';
  const q = encodeURIComponent($('#fixer-input').value.trim());
  let items;
  try {
    items = await api(`/api/games/${game.id}/candidates?q=${q}`);
  } catch (err) {
    results.innerHTML = `<p class="fixer-hint">Recherche impossible : ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!items.length) {
    results.innerHTML = '<p class="fixer-hint">Aucun résultat. Essaie le titre anglais ou une orthographe plus courte.</p>';
    return;
  }
  results.innerHTML = items.map((it, i) => `
    <button class="fixer-item" data-i="${i}">
      <img src="${escapeHtml(it.preview)}" alt="" loading="lazy">
      <span>${escapeHtml(it.name)}</span>
      <small>${Math.round(it.score * 100)} %</small>
    </button>`).join('');

  $$('.fixer-item', results).forEach((el) => {
    el.onclick = async () => {
      const item = items[Number(el.dataset.i)];
      el.disabled = true;
      try {
        await api(`/api/games/${game.id}/scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ match: `${item.name}.png` }),
        });
        await refresh();
        closeFixer();
        toast('Jaquette mise à jour.');
      } catch (err) {
        toast(err.message);
        el.disabled = false;
      }
    };
  });
}

/* -------------------------------------------------- Scraping du catalogue */

let scrapeTimer = null;

async function startScrape(onlyMissing = true) {
  const r = await api('/api/scrape/all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onlyMissing }),
  });
  if (!r.started) { toast(r.reason); return; }
  toast(`Récupération lancée pour ${r.total} jeu(x).`);
  pollScrape();
}

function pollScrape() {
  clearInterval(scrapeTimer);
  const bar = $('#scrape-progress');
  scrapeTimer = setInterval(async () => {
    let s;
    try { s = await api('/api/scrape/status'); } catch { return; }
    if (!s.running && !s.total) { bar.hidden = true; return; }

    bar.hidden = false;
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    $('.scrape-bar', bar).style.width = `${pct}%`;
    $('.scrape-label', bar).textContent = s.running
      ? `${s.done}/${s.total} — ${s.current || '…'}`
      : `Terminé : ${s.ok} sûres · ${s.uncertain} à vérifier · ${s.notfound} introuvables`;

    if (!s.running) {
      clearInterval(scrapeTimer);
      await refresh();
      setTimeout(() => { bar.hidden = true; }, 6000);
    }
  }, 900);
}

/* ------------------------------------------------------------- Lecteur */

function play(id, { resume = true } = {}) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  // Un jeu natif ne s'ouvre pas dans le lecteur : il part sur le PC
  if (game.runtime === 'native') { launchNative(game); return; }
  $('#view-detail').hidden = true;
  const player = $('#view-player');
  $('.player-title', player).textContent = `${game.title} — ${game.consoleName}`;

  // On ne demande la reprise que s'il y a réellement une sauvegarde, et que
  // le jeu passe par l'émulateur — un fangame HTML5 gère ses propres sauvegardes
  const wantResume = resume && game.resume && game.runtime === 'web';
  const cadre = $('#player-frame');
  /*
   * Le cadre doit prendre le focus, sinon la manette ne marche pas.
   *
   * Chrome ne livre l'etat des manettes qu'au document focalise. Le lecteur
   * vit dans une iframe ; tant que le focus reste sur la page qui l'entoure,
   * navigator.getGamepads() y renvoie une liste vide et l'emulateur ne voit
   * rien — alors meme que la manette fonctionne parfaitement ailleurs.
   *
   * C'est sans effet sur le clavier : le lecteur renvoie deja Echap, la
   * sauvegarde et la capture au parent par postMessage.
   */
  cadre.addEventListener('load', () => {
    cadre.focus();
    try { cadre.contentWindow?.focus(); } catch { /* origine differente */ }
  }, { once: true });
  cadre.src = `/player.html?id=${game.id}${wantResume ? '&resume=1' : ''}`;

  $('.player-hint', player).textContent = game.runtime === 'web'
    ? 'Échap pour quitter — ta partie est sauvegardée automatiquement'
    : 'Échap pour quitter';

  player.hidden = false;
  state.playing = game.id;
  state.playingDisc = 0;
  state.playStart = Date.now();
  renderDiscs(game);
}

/* ------------------------------------------------------ Multi-disques */

/**
 * Sélecteur de disque, affiché seulement pour les jeux qui en ont plusieurs.
 * `native` est vrai quand le cœur gère lui-même la pile de disques : la
 * bascule est alors instantanée. Sinon on recharge sur l'autre fichier.
 */
function renderDiscs(game, { native = 0 } = {}) {
  const box = $('#player-discs');
  const count = native || game.discs || 1;
  if (count < 2) { box.hidden = true; return; }

  box.hidden = false;
  box.innerHTML = `<span class="pd-label">Disque</span>`
    + Array.from({ length: count }, (_, i) => `
        <button class="pd-btn${i === state.playingDisc ? ' on' : ''}" data-i="${i}">${i + 1}</button>
      `).join('');

  $$('.pd-btn', box).forEach((el) => {
    el.onclick = () => switchDisc(game, Number(el.dataset.i), native > 0);
  });
}

/**
 * Change de disque. Sans gestion native, on sauvegarde la partie, on recharge
 * le lecteur sur l'autre fichier, puis on restaure — c'est exactement la
 * manœuvre qu'on faisait à la main sur console, en moins pénible.
 */
async function switchDisc(game, index, native) {
  if (index === state.playingDisc) return;
  const frame = $('#player-frame');

  if (native) {
    frame.contentWindow.postMessage({ type: 'dimstorted:set-disk', index }, '*');
    state.playingDisc = index;
    renderDiscs(game, { native: game.discs });
    toast(`Disque ${index + 1}.`);
    return;
  }

  $('.player-hint').textContent = 'Changement de disque…';
  // L'état est conservé : la partie reprend là où elle en était
  await requestSave();

  state.playingDisc = index;
  frame.src = `/player.html?id=${game.id}&disc=${index}&resume=1`;
  renderDiscs(game);
  $('.player-hint').textContent = `Disque ${index + 1} — Échap pour quitter`;
  toast(`Disque ${index + 1} inséré, partie restaurée.`);
}

/**
 * Demande au lecteur d'enregistrer l'état, puis ferme.
 * On attend la confirmation, avec une limite de temps : mieux vaut fermer
 * sans sauvegarde que laisser l'écran figé si l'émulateur ne répond pas.
 */
function requestSave(timeout = 6000) {
  const frame = $('#player-frame');
  if (!frame.contentWindow || state.playing == null) return Promise.resolve(false);

  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      removeEventListener('message', onMessage);
      resolve(ok);
    };
    const onMessage = (e) => {
      if (e.data?.type === 'dimstorted:saved') finish(Boolean(e.data.ok));
    };
    addEventListener('message', onMessage);
    frame.contentWindow.postMessage({ type: 'dimstorted:save-and-quit' }, '*');
    setTimeout(() => finish(false), timeout);
  });
}

/**
 * Sauvegarde manuelle dans le premier emplacement libre.
 * Les emplacements 1 à 9 ne sont jamais écrasés automatiquement : seule la
 * reprise (emplacement 0) l'est.
 */
async function saveToSlot() {
  const id = state.playing;
  if (id == null) return;
  const frame = $('#player-frame');
  if (!frame.contentWindow) return;

  let used = [];
  try { used = (await api(`/api/games/${id}/saves`)).map((s) => s.slot); } catch { /* liste indisponible */ }

  let slot = 1;
  while (slot <= 9 && used.includes(slot)) slot++;
  if (slot > 9) slot = 1; // les neuf emplacements sont pris : on recycle le premier

  const done = await new Promise((resolve) => {
    const onMessage = (e) => {
      if (e.data?.type !== 'dimstorted:saved-slot') return;
      removeEventListener('message', onMessage);
      resolve(Boolean(e.data.ok));
    };
    addEventListener('message', onMessage);
    frame.contentWindow.postMessage({ type: 'dimstorted:save-slot', slot }, '*');
    setTimeout(() => { removeEventListener('message', onMessage); resolve(false); }, 8000);
  });

  toast(done ? `Sauvegardé dans l’emplacement ${slot}.` : 'Sauvegarde impossible.');
  if (done) await refresh();
}

async function stopPlaying() {
  const player = $('#view-player');
  if (player.hidden) return;

  const id = state.playing;
  const seconds = Math.round((Date.now() - state.playStart) / 1000);

  $('.player-hint', player).textContent = 'Sauvegarde de la partie…';
  const saved = await requestSave();

  player.hidden = true;
  $('#player-frame').src = 'about:blank';
  state.playing = null;

  if (id != null) {
    try {
      await api(`/api/games/${id}/played`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds }),
      });
    } catch { /* le temps de jeu n'est pas critique */ }
    await refresh();
    if (saved) toast('Partie sauvegardée — tu reprendras ici.');
  }
}

/* -------------------------------------------------------------- Import */

function openImport(tab = 'add') {
  $('#view-import').hidden = false;
  $('#import-path').textContent = state.status?.paths?.import || '';
  // Pas de barre de progression figée d'une session précédente
  $('#scrape-progress').hidden = true;
  $('#scan-row').hidden = true;
  setManageTab(tab);
  loadQueue();
  renderScrapeInfo();
  loadDuplicates();
  loadRejected();
  loadEmulators();
  loadBackups();
  pollScrape();
}

/** Une seule tâche visible à la fois. */
function setManageTab(tab) {
  $$('.mtab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
}

function renderScrapeInfo() {
  const s = state.status?.scrape;
  const el = $('#scrape-info');
  if (!s) { el.textContent = ''; return; }
  const total = (s.ok || 0) + (s.uncertain || 0) + (s.notfound || 0) + (s.none || 0);
  if (!total) { el.textContent = 'Aucun jeu au catalogue pour le moment.'; return; }

  const missing = (s.notfound || 0) + (s.none || 0);
  const bits = [`${s.ok || 0} sur ${total} complètes`];
  if (s.uncertain) bits.push(`${s.uncertain} à vérifier`);
  if (missing) bits.push(`${missing} sans jaquette`);
  el.textContent = bits.join(' · ');
}

async function loadQueue() {
  const queue = await api('/api/import/queue');
  const box = $('#queue');
  box.textContent = '';
  $('#queue-count').textContent = queue.length;
  // Le bloc entier disparaît quand il n'y a rien : une file vide n'a rien à dire
  $('#queue-block').hidden = !queue.length;
  if (!queue.length) return;

  const options = state.consoles.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  for (const item of queue) {
    const el = document.createElement('div');
    el.className = 'q-item';
    const confLabel = { high: 'SÛR', medium: 'PROBABLE', low: 'À CONFIRMER' }[item.confidence];
    el.innerHTML = `
      <div class="q-main">
        <div class="q-file">${escapeHtml(item.file)} · ${fmtSize(item.size)}</div>
        <div class="q-fields">
          <input class="q-title" value="${escapeHtml(item.title || '')}" placeholder="Titre du jeu">
          <select class="q-console"><option value="">— Console —</option>${options}</select>
        </div>
        <div class="q-reason">
          <span class="conf conf-${item.confidence}">${confLabel}</span>
          <span style="color:var(--text-dim)">${escapeHtml(item.reason || '')}</span>
        </div>
      </div>
      <div class="q-actions">
        <button class="btn btn-play q-accept">Ajouter</button>
        <button class="btn btn-ghost q-reject">Ignorer</button>
      </div>`;
    $('.q-console', el).value = item.console || '';

    $('.q-accept', el).onclick = async () => {
      const consoleId = $('.q-console', el).value;
      if (!consoleId) { toast('Choisis une console avant de valider.'); return; }
      try {
        const r = await api(`/api/import/queue/${item.id}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ console: consoleId, title: $('.q-title', el).value }),
        });
        await refresh();
        await loadQueue();
        // Le serveur récupère jaquette et synopsis tout seul : on suit
        if (r.scraping) pollScrape();
      } catch (err) {
        toast(err.message);
        // Un doublon sort de la file : inutile de le reproposer
        if (/Doublon/i.test(err.message)) { await loadQueue(); await loadRejected(); }
      }
    };
    $('.q-reject', el).onclick = async () => {
      await api(`/api/import/queue/${item.id}/reject`, { method: 'POST' });
      await loadQueue();
      renderQueueCount();
    };
    box.appendChild(el);
  }
}

async function renderQueueCount() {
  try {
    const n = state.status?.pending ?? 0;
    $('#queue-count').textContent = n;
  } catch { /* sans importance */ }
}

function setupDropzone() {
  const dz = $('#dropzone');
  const input = $('#file-input');

  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove('drag');
  }));

  dz.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });
  $('#btn-browse').onclick = () => input.click();
  input.onchange = () => { if (input.files.length) uploadFiles(input.files); };
}

/* Envoi via XHR plutot que fetch : seul XHR expose la progression d'upload,
   indispensable quand on depose un ISO de plusieurs gigaoctets. */
function uploadFiles(fileList) {
  const form = new FormData();
  for (const f of fileList) form.append('files', f);

  const prog = $('.dz-progress');
  const bar = $('.dz-bar');
  const label = $('.dz-label');
  prog.hidden = false;
  bar.style.width = '0%';
  label.textContent = `Envoi de ${fileList.length} fichier(s)…`;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/import/upload');
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    bar.style.width = `${pct}%`;
    label.textContent = `Envoi… ${pct}% (${fmtSize(e.loaded)} / ${fmtSize(e.total)})`;
  };
  xhr.onload = async () => {
    prog.hidden = true;
    if (xhr.status >= 400) { toast('Échec de l’envoi.'); return; }
    const r = JSON.parse(xhr.responseText);
    toast(`${r.uploaded} fichier(s) reçu(s), ${r.queued} en attente de validation.`);
    await refresh();
    await loadQueue();
  };
  xhr.onerror = () => { prog.hidden = true; toast('Échec de l’envoi.'); };
  xhr.send(form);
}

/* ------------------------------------------------------ Palette Ctrl+K */

let paletteIndex = 0;
let paletteHits = [];

function openPalette() {
  $('#palette').hidden = false;
  const input = $('#palette-input');
  input.value = '';
  input.focus();
  updatePalette('');
}

function updatePalette(q) {
  const query = q.trim().toLowerCase();
  paletteHits = (query
    ? state.games.filter((g) => g.title.toLowerCase().includes(query))
    : state.games.slice(0, 8)
  ).slice(0, 8);
  paletteIndex = 0;
  drawPalette();
}

function drawPalette() {
  const box = $('#palette-results');
  if (!paletteHits.length) {
    box.innerHTML = '<div class="p-empty">Aucun jeu trouvé.</div>';
    return;
  }
  box.innerHTML = paletteHits.map((g, i) => `
    <div class="p-item ${i === paletteIndex ? 'sel' : ''}" data-i="${i}">
      <span>${escapeHtml(g.title)}</span>
      <small>${escapeHtml(g.consoleShort)}</small>
    </div>`).join('');
  $$('.p-item', box).forEach((el) => {
    el.onclick = () => runPalette(Number(el.dataset.i));
  });
}

function runPalette(i) {
  const game = paletteHits[i];
  if (!game) return;
  $('#palette').hidden = true;
  play(game.id);
}

/* --------------------------------------------------------------- Divers */

let toastTimer;
/* ------------------------------------------------------------- Profils */

/**
 * Les profils separent les parties : chacun a ses sauvegardes, ses captures,
 * son temps de jeu et sa liste. Le profil actif est tenu par le serveur, donc
 * changer de profil veut dire recharger la bibliotheque — c'est exactement ce
 * que fait refresh().
 */

const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

function faceStyle(profile) {
  const c = profile.color || '#e50914';
  return `background:linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 45%, #000))`;
}

function renderAvatar() {
  const el = $('#avatar');
  if (!el) return;
  const p = state.profile;
  el.textContent = initial(p?.name);
  el.style.setProperty('--pc', p?.color || '#e50914');
  el.title = p ? `${p.name} — changer de profil` : 'Profils';
}

/* ---- Menu du compte ---- */

function closeAccountMenu() {
  const menu = $('#account-menu');
  menu.hidden = true;
  $('#avatar').setAttribute('aria-expanded', 'false');
}

function toggleAccountMenu(force) {
  const menu = $('#account-menu');
  const open = force ?? menu.hidden;
  if (!open) return closeAccountMenu();

  const others = state.profiles.filter((p) => p.id !== state.profile?.id);
  menu.innerHTML = `
    ${others.length ? '<div class="account-head">Changer de profil</div>' : ''}
    ${others.map((p) => `
      <button class="account-item" data-switch="${p.id}">
        <span class="dot" style="${faceStyle(p)}">${escapeHtml(initial(p.name))}</span>
        <span>${escapeHtml(p.name)}</span>
      </button>`).join('')}
    ${others.length ? '<div class="account-sep"></div>' : ''}
    <button class="account-item" data-act="manage">Gérer les profils</button>
    <button class="account-item" data-act="switch">Changer de profil</button>
  `;
  menu.hidden = false;
  $('#avatar').setAttribute('aria-expanded', 'true');

  $$('[data-switch]', menu).forEach((b) => {
    b.onclick = () => { closeAccountMenu(); switchProfile(Number(b.dataset.switch)); };
  });
  $('[data-act="manage"]', menu).onclick = () => { closeAccountMenu(); openProfiles(true); };
  $('[data-act="switch"]', menu).onclick = () => { closeAccountMenu(); openProfiles(false); };
}

/* ---- Écran « Qui joue ? » ---- */

let manageMode = false;

const PENCIL_PATH = 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25z'
  + 'M20.7 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
const PENCIL = `<span class="pencil"><svg viewBox="0 0 24 24"><path d="${PENCIL_PATH}"/></svg></span>`;

function openProfiles(manage = false) {
  manageMode = manage;
  drawProfiles();
  $('#view-profiles').hidden = false;
}

function closeProfiles() {
  $('#view-profiles').hidden = true;
  manageMode = false;
}

function drawProfiles() {
  const grid = $('#profiles-grid');
  const canAdd = state.profiles.length < 6;

  grid.innerHTML = state.profiles.map((p) => `
    <li>
      <button class="profile-tile${p.id === state.profile?.id ? ' current' : ''}" data-id="${p.id}">
        <span class="profile-face" style="${faceStyle(p)}">
          ${manageMode ? PENCIL : escapeHtml(initial(p.name))}
        </span>
        <span class="profile-name">${escapeHtml(p.name)}</span>
      </button>
    </li>`).join('')
    + (manageMode && canAdd ? `
    <li>
      <button class="profile-tile add" data-add="1">
        <span class="profile-face">+</span>
        <span class="profile-name">Ajouter un profil</span>
      </button>
    </li>` : '');

  $('.profiles-title').textContent = manageMode ? 'Gérer les profils' : 'Qui joue ?';
  $('#profiles-manage').hidden = manageMode;
  $('#profiles-done').hidden = !manageMode;

  $$('[data-id]', grid).forEach((b) => {
    b.onclick = () => {
      const p = state.profiles.find((x) => x.id === Number(b.dataset.id));
      if (manageMode) openProfileEditor(p);
      else if (p.id === state.profile?.id) closeProfiles();
      else switchProfile(p.id);
    };
  });
  const add = $('[data-add]', grid);
  if (add) add.onclick = () => openProfileEditor(null);
}

async function switchProfile(id) {
  // Une partie en cours appartient au profil qu'on quitte : on la referme
  // proprement pour que son état parte dans le bon dossier.
  if (state.playing != null) await stopPlaying();
  try {
    const r = await api(`/api/profiles/${id}/select`, { method: 'POST' });
    await refresh();
    closeProfiles();
    sessionStorage.setItem('dimstorted:profile-chosen', '1');
    toast(`Profil « ${r.profile.name} »`);
  } catch (err) {
    toast(err.message);
  }
}

/* ---- Fiche d'un profil ---- */

let editing = null;
let editingColor = null;

function openProfileEditor(profile) {
  editing = profile;
  editingColor = profile?.color || state.profileColors[0];

  $('#profile-edit-title').textContent = profile ? 'Modifier le profil' : 'Nouveau profil';
  $('#profile-name').value = profile?.name || '';
  $('#profile-delete').hidden = !profile || state.profiles.length <= 1;
  drawSwatches();
  drawPreview();
  $('#view-profile-edit').hidden = false;
  $('#profile-name').focus();
}

function closeProfileEditor() {
  $('#view-profile-edit').hidden = true;
  editing = null;
}

function drawSwatches() {
  const box = $('#profile-colors');
  box.innerHTML = state.profileColors.map((c) => `
    <button class="swatch" style="background:${c}" data-color="${c}"
            aria-pressed="${c === editingColor}" aria-label="Couleur ${c}"></button>`).join('');
  $$('[data-color]', box).forEach((b) => {
    b.onclick = () => { editingColor = b.dataset.color; drawSwatches(); drawPreview(); };
  });
}

function drawPreview() {
  const el = $('#profile-preview');
  const name = $('#profile-name').value;
  el.textContent = initial(name || editing?.name);
  el.setAttribute('style', faceStyle({ color: editingColor }));
}

async function saveProfile() {
  const name = $('#profile-name').value.trim();
  if (!name) { toast('Donne un nom à ce profil.'); return; }
  try {
    if (editing) {
      await api(`/api/profiles/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: editingColor }),
      });
    } else {
      await api('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: editingColor }),
      });
    }
    closeProfileEditor();
    await refresh();
    drawProfiles();
    toast(editing ? 'Profil modifié.' : `Profil « ${name} » créé.`);
  } catch (err) {
    toast(err.message);
  }
}

function deleteProfile() {
  if (!editing) return;
  const modal = $('#view-confirm');
  $('.confirm-text', modal).innerHTML =
    `Supprimer le profil <b>${escapeHtml(editing.name)}</b> ?<br>`
    + 'Ses sauvegardes, ses captures et son temps de jeu seront effacés.';
  // La case « supprimer aussi les fichiers du disque » ne concerne que les
  // jeux : supprimer un profil efface toujours ses fichiers a lui.
  const check = $('.confirm-check', modal);
  check.hidden = true;
  $('#confirm-ok').textContent = 'Supprimer';
  modal.hidden = false;

  const restore = () => { check.hidden = false; $('#confirm-ok').textContent = 'Retirer'; };
  $('#confirm-cancel').onclick = () => { modal.hidden = true; restore(); };
  $('#confirm-ok').onclick = async () => {
    try {
      await api(`/api/profiles/${editing.id}`, { method: 'DELETE' });
      modal.hidden = true;
      restore();
      closeProfileEditor();
      await refresh();
      drawProfiles();
      toast('Profil supprimé.');
    } catch (err) { toast(err.message); }
  };
}

/* ------------------------------------------------- Effet cathodique global */

const FX = ['aucun', 'scanlines', 'crt', 'phosphore'];
const TEINTES = ['rouge', 'bleu', 'vert', 'orange', 'violet'];

/**
 * L'effet s'applique a toute l'interface, pas au seul jeu — les shaders du
 * lecteur, eux, restent regles par console dans l'onglet Image.
 * Le choix vit dans le navigateur : c'est un confort visuel personnel, il n'a
 * pas a suivre le profil ni a partir dans la sauvegarde.
 */
function appliquerFx(nom) {
  if (!nom || nom === 'aucun') document.body.removeAttribute('data-fx');
  else document.body.dataset.fx = nom;
  try { localStorage.setItem('dimstorted:fx', nom || 'aucun'); } catch { /* mode prive */ }
}

/*
 * Le selecteur d'effet cathodique repose sur des textures du theme. On ne
 * peut pas trancher au demarrage — le statut du serveur n'est pas encore
 * arrive —, donc cette mise a jour se fait apres le premier chargement.
 */
function majEffetsDisponibles() {
  const rangee = $('#fx-select')?.closest('.vid-row');
  if (rangee) rangee.hidden = !themePresent();
  if (!themePresent()) appliquerFx('aucun');
}

function fxInitial() {
  let nom = 'aucun';
  try { nom = localStorage.getItem('dimstorted:fx') || 'aucun'; } catch { /* mode prive */ }
  if (!FX.includes(nom)) nom = 'aucun';
  appliquerFx(nom);
  const sel = $('#fx-select');
  if (sel) {
    sel.value = nom;
    // Apercu immediat : on juge un effet en le voyant, pas en lisant son nom
    sel.onchange = () => appliquerFx(sel.value);
  }
}

/* Le rouge est la teinte d'origine : elle n'a pas besoin d'attribut. */
function appliquerTeinte(nom) {
  if (!nom || nom === 'rouge') document.body.removeAttribute('data-teinte');
  else document.body.dataset.teinte = nom;
  try { localStorage.setItem('dimstorted:teinte', nom || 'rouge'); } catch { /* mode prive */ }
}

function teinteInitiale() {
  let nom = 'rouge';
  try { nom = localStorage.getItem('dimstorted:teinte') || 'rouge'; } catch { /* mode prive */ }
  if (!TEINTES.includes(nom)) nom = 'rouge';
  appliquerTeinte(nom);
  const sel = $('#teinte-select');
  if (sel) {
    sel.value = nom;
    sel.onchange = () => appliquerTeinte(sel.value);
  }
}

function wireProfiles() {
  const avatar = $('#avatar');
  const account = $('#account');

  avatar.addEventListener('click', () => toggleAccountMenu());
  account.addEventListener('mouseenter', () => toggleAccountMenu(true));
  account.addEventListener('mouseleave', closeAccountMenu);
  document.addEventListener('click', (e) => {
    if (!account.contains(e.target)) closeAccountMenu();
  });

  $('#profiles-manage').onclick = () => { manageMode = true; drawProfiles(); };
  $('#profiles-done').onclick = () => { manageMode = false; drawProfiles(); };

  $('#profile-edit-close').onclick = closeProfileEditor;
  $('#profile-cancel').onclick = closeProfileEditor;
  $('#profile-save').onclick = saveProfile;
  $('#profile-delete').onclick = deleteProfile;
  $('#profile-name').addEventListener('input', drawPreview);
  $('#profile-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveProfile(); }
  });
}

/**
 * Netflix demande qui regarde a chaque ouverture. Ici, tant qu'il n'y a qu'un
 * profil la question n'a pas de sens : on ne la pose qu'a partir de deux, et
 * une seule fois par onglet.
 */
function maybeAskWhoIsPlaying() {
  if (state.profiles.length < 2) return;
  if (sessionStorage.getItem('dimstorted:profile-chosen')) return;
  openProfiles(false);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

function setView(view) {
  if (view !== 'consoles') state.consoleChoisie = null;
  state.view = view;
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  render();
}

/* ------------------------------------------------------------ Amorcage */

function init() {
  window.addEventListener('scroll', () => {
    $('#nav').classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  $$('[data-view]').forEach((el) => {
    el.onclick = () => setView(el.dataset.view);
  });

  $('#btn-import').onclick = openImport;
  $('#nav-controls').onclick = () => openControls();
  $('#nav-stats').onclick = openStats;
  $('#btn-random').onclick = randomGame;

  $('#btn-backup').onclick = async () => {
    const btn = $('#btn-backup');
    btn.disabled = true;
    btn.textContent = 'Sauvegarde…';
    try {
      const r = await api('/api/backup', { method: 'POST' });
      toast(`Sauvegarde créée : ${r.name} (${fmtSize(r.size)}).`);
      await loadBackups();
    } catch (err) { toast(err.message); }
    btn.disabled = false;
    btn.textContent = 'Sauvegarder';
  };
  $('#nav-tv').onclick = () => setTvMode(!pad.on);

  // Une manette branchée pendant la navigation démarre l'écoute
  addEventListener('gamepadconnected', () => {
    if (!pad.raf) padTick();
    toast('Manette détectée — tu peux naviguer avec.');
  });

  // Flèches du clavier : même navigation que la manette, hors saisie
  addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
    if (typing || ctrlState.listening !== null) return;
    if (!$('#view-player').hidden) return;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[e.key]) { e.preventDefault(); moveFocus(...moves[e.key]); }
  });
  $('#empty-import').onclick = openImport;
  $('#btn-quit').onclick = stopPlaying;
  $('#btn-save-slot').onclick = saveToSlot;
  $('#btn-shot').onclick = takeShot;

  $$('[data-close]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.close === 'fixer') closeFixer();
      else if (btn.dataset.close === 'edit') closeEditor();
      else $(`#view-${btn.dataset.close}`).hidden = true;
    };
  });

  $$('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target !== ov) return;
      if (ov.id === 'view-fixer') closeFixer();
      else ov.hidden = true;
    });
  });

  $('#search-input').addEventListener('input', (e) => {
    state.query = e.target.value;
    render();
  });

  // Filtres : chaque changement relance le rendu, pas besoin de valider
  for (const [key, id] of Object.entries({
    console: '#f-console', genre: '#f-genre', year: '#f-year',
    players: '#f-players', sort: '#f-sort',
  })) {
    $(id).onchange = (e) => { state.filters[key] = e.target.value; render(); };
  }
  $('#f-reset').onclick = () => {
    state.filters = { console: '', genre: '', year: '', players: '', sort: 'title' };
    state.query = '';
    $('#search-input').value = '';
    render();
  };

  $('#btn-scan').onclick = async () => {
    const dir = $('#scan-path').value.trim();
    try {
      const r = await api('/api/import/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dir ? { path: dir } : {}),
      });
      if (r.error) { toast(r.error); return; }
      const bits = [`${r.scanned} fichier(s) analysé(s)`, `${r.queued} en attente`];
      if (r.extracted?.length) bits.push(`${r.extracted.length} archive(s) décompressée(s)`);
      if (r.failed?.length) bits.push(`${r.failed.length} archive(s) refusée(s)`);
      toast(`${bits.join(' · ')}.`);
      if (r.failed?.length) {
        // Une archive refusée mérite son propre message : la raison compte
        setTimeout(() => toast(`${r.failed[0].file} : ${r.failed[0].error}`), 4500);
      }
      await loadQueue();
      await loadRejected();
    } catch (err) { toast(err.message); }
  };

  const acceptBatch = async (all) => {
    const r = await api('/api/import/accept-confident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all }),
    });
    const bits = [`${r.accepted} jeu(x) ajouté(s)`];
    if (r.skipped) bits.push(`${r.skipped} laissé(s) à l’arbitrage`);
    if (r.failed.length) bits.push(`${r.failed.length} en échec`);
    if (r.scraping) bits.push('jaquettes en cours de récupération');
    toast(`${bits.join(' · ')}.`);
    if (r.failed.length) {
      setTimeout(() => toast(`${r.failed[0].file} : ${r.failed[0].error}`), 4500);
    }
    await refresh();
    await loadQueue();
    await loadRejected();
    // Le serveur a lancé la récupération : on affiche sa progression, et on
    // rafraîchit la bibliothèque quand elle se termine
    if (r.scraping) pollScrape();
  };
  $('#btn-accept-all').onclick = () => acceptBatch(true);
  $('#btn-accept-confident').onclick = () => acceptBatch(false);

  $('#ctrl-save').onclick = saveControls;
  $('#ctrl-reset').onclick = async () => {
    await api(`/api/controls/${ctrlState.console}`, { method: 'DELETE' });
    await loadControls(ctrlState.console);
    toast('Réglages par défaut rétablis.');
  };
  // En capture : la touche ne doit pas déclencher les raccourcis de la page
  addEventListener('keydown', captureKey, true);

  $('#edit-cancel').onclick = closeEditor;
  $('#edit-save').onclick = saveEditor;
  $('#edit-cover-btn').onclick = () => $('#edit-cover-file').click();
  $('#edit-cover-file').onchange = (e) => {
    editorCover = e.target.files[0] || null;
    $('#edit-cover-name').textContent = editorCover ? editorCover.name : '';
  };

  $$('.mtab').forEach((b) => { b.onclick = () => setManageTab(b.dataset.tab); });
  $('#btn-show-scan').onclick = () => {
    const row = $('#scan-row');
    row.hidden = !row.hidden;
    if (!row.hidden) $('#scan-path').focus();
  };

  // L'ordre des régions se modifie à la demande, pas en permanence à l'écran
  $('#btn-edit-regions').onclick = () => {
    const current = (state.regionPreference || []).join(', ');
    const value = prompt('Ordre de priorité des régions, séparées par des virgules :', current);
    if (value === null) return;
    const list = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) { toast('Indique au moins une région.'); return; }
    api('/api/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preference: list }),
    })
      .then(async () => {
        await refresh();
        await loadDuplicates();
        toast(`Priorité : ${list.join(' → ')}`);
      })
      .catch((err) => toast(err.message));
  };

  $('#btn-scrape-missing').onclick = () => startScrape(true);
  $('#btn-scrape-all').onclick = () => startScrape(false);

  // Raccourcis relayés par le lecteur, qui a le focus pendant une partie
  addEventListener('message', (e) => {
    if (e.data?.type === 'dimstorted:request-save-slot') saveToSlot();
    if (e.data?.type === 'dimstorted:request-shot') takeShot();
    if (e.data?.type === 'dimstorted:request-quit') stopPlaying();
    // Le cœur peut gérer lui-même plusieurs disques : on l'apprend au démarrage
    if (e.data?.type === 'dimstorted:ready' && e.data.nativeDisks) {
      const game = state.games.find((g) => g.id === state.playing);
      if (game) {
        state.playingDisc = e.data.currentDisk || 0;
        renderDiscs(game, { native: e.data.nativeDisks });
      }
    }
  });

  setupDropzone();

  const pInput = $('#palette-input');
  pInput.addEventListener('input', (e) => updatePalette(e.target.value));
  pInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteHits.length - 1); drawPalette(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); drawPalette(); }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
  });

  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); openPalette(); return;
    }
    // Ctrl+S pendant une partie : sauvegarde manuelle
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.playing != null) {
      e.preventDefault(); saveToSlot(); return;
    }
    if (e.key === '/' && !typing) { e.preventDefault(); $('#search-input').focus(); return; }
    if (e.key === 'Escape') {
      if (!$('#palette').hidden) { $('#palette').hidden = true; return; }
      if (!$('#view-profile-edit').hidden) { closeProfileEditor(); return; }
      // L'ecran « Qui joue ? » ne se ferme que si un profil est deja actif
      if (!$('#view-profiles').hidden) { closeProfiles(); return; }
      if (!$('#view-player').hidden) { stopPlaying(); return; }
      if (!$('#view-fixer').hidden) { closeFixer(); return; }
      if (!$('#view-edit').hidden) { closeEditor(); return; }
      if (!$('#view-detail').hidden) { $('#view-detail').hidden = true; return; }
      if (!$('#view-import').hidden) { $('#view-import').hidden = true; }
    }
  });

  wireProfiles();
  fxInitial();
  teinteInitiale();

  // Ossature immédiate : la page ne reste jamais vide pendant le chargement
  $('#rows').appendChild(skeleton());

  refresh()
    .then(() => {
      maybeAskWhoIsPlaying();
      // Lien direct vers l'ecran d'ajout : dimstorted/#import
      if (location.hash === '#import') openImport();
    })
    .catch((err) => toast(`Impossible de charger la bibliothèque : ${err.message}`));
}

init();
