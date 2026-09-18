/**
 * Prépare l'index LaunchBox Games Database.
 *
 * Pourquoi cette source : libretro ne publie de synopsis que pour les
 * systèmes à disque. Sur Master System, 1 entrée sur 623 en a un ; sur
 * Game Boy, 1 sur 1666. LaunchBox en a pour 91 % de ses 188 000 jeux, et
 * couvre 89 à 100 % selon les plateformes de cette bibliothèque.
 *
 * Le dump fait 107 Mo compressés et 510 Mo décompressés. On n'en garde que
 * les plateformes utiles et les champs utiles — environ 6 Mo — pour que la
 * recherche soit instantanée et se fasse hors ligne.
 *
 *   node scripts/fetch-launchbox.js [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PLATEFORMES } from '../server/scrapers/launchbox-plateformes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_DUMP = 'https://gamesdb.launchbox-app.com/Metadata.zip';
const DEST = path.join(ROOT, 'data', 'launchbox.json');
const TMP = path.join(ROOT, 'data', 'launchbox-tmp');

const VOULUES = new Set(Object.values(PLATEFORMES).flat());

function telecharger(dest) {
  console.log(`[launchbox] téléchargement du dump (107 Mo)…`);
  execFileSync('curl', ['-sL', '--max-time', '900', '-o', dest, URL_DUMP], { stdio: 'inherit' });
  const mo = fs.statSync(dest).size / 1e6;
  if (mo < 50) throw new Error(`dump incomplet (${mo.toFixed(0)} Mo)`);
  console.log(`[launchbox] reçu : ${mo.toFixed(0)} Mo`);
}

/**
 * Extrait Metadata.xml du zip. Node ne sait pas lire un zip nativement ;
 * `tar.exe` de Windows (bsdtar) le fait, et il est déjà utilisé ailleurs
 * dans le projet pour les .7z.
 */
function extraire(zip, vers) {
  fs.mkdirSync(vers, { recursive: true });
  const outils = ['/mnt/c/Windows/System32/tar.exe', 'bsdtar', 'tar'];
  for (const outil of outils) {
    try {
      execFileSync(outil, ['-xf', zip, '-C', vers, 'Metadata.xml'], { stdio: 'pipe' });
      const p = path.join(vers, 'Metadata.xml');
      if (fs.existsSync(p)) return p;
    } catch { /* outil suivant */ }
  }
  throw new Error('aucun outil capable d’extraire le zip');
}

/**
 * Lit le XML en flux. 510 Mo ne tiennent pas confortablement en mémoire, et
 * on n'a besoin que d'une poignée de champs : on découpe sur les balises
 * <Game> plutôt que de construire un arbre.
 */
function indexer(xmlPath) {
  const CHAMPS = ['Name', 'Platform', 'Overview', 'Developer', 'Publisher',
                  'Genres', 'MaxPlayers', 'ReleaseDate', 'CommunityRating',
                  'DatabaseID'];
  const jeux = [];
  const logos = new Map();   // DatabaseID -> chemin de l'image chez LaunchBox
  const fonds = new Map();   // idem, pour l'illustration de fond
  let reste = '';
  let lus = 0;

  /*
   * Le fichier contient deux sortes de blocs qui nous interessent : les
   * <Game> et les <GameImage>. On les lit dans la meme passe — 510 Mo relus
   * une seconde fois, c'est une minute de perdue pour rien.
   *
   * Les deux recherches ne se marchent pas dessus : « </GameImage> » ne
   * contient pas « </Game> » (le caractere suivant est un I, pas un >), et
   * « <GameImage> » ne contient pas « <Game> » pour la meme raison.
   */
  const flux = fs.createReadStream(xmlPath, { encoding: 'utf8', highWaterMark: 1 << 20 });
  return new Promise((resolve, reject) => {
    flux.on('error', reject);
    flux.on('data', (morceau) => {
      reste += morceau;
      for (;;) {
        const iJeu = reste.indexOf('</Game>');
        const iImg = reste.indexOf('</GameImage>');
        if (iJeu === -1 && iImg === -1) break;

        if (iImg === -1 || (iJeu !== -1 && iJeu < iImg)) {
          const debut = reste.lastIndexOf('<Game>', iJeu);
          if (debut === -1) { reste = reste.slice(iJeu + 7); continue; }
          const bloc = reste.slice(debut, iJeu);
          reste = reste.slice(iJeu + 7);
          lus += 1;

          if (!VOULUES.has(champ(bloc, 'Platform'))) continue;
          const entree = {};
          for (const c of CHAMPS) {
            const v = champ(bloc, c);
            if (v) entree[c] = v;
          }
          if (entree.Name) jeux.push(entree);
        } else {
          const debut = reste.lastIndexOf('<GameImage>', iImg);
          if (debut === -1) { reste = reste.slice(iImg + 12); continue; }
          const bloc = reste.slice(debut, iImg);
          reste = reste.slice(iImg + 12);

          /*
           * Deux sortes d'images nous interessent :
           *   Clear Logo          le lettrage du jeu, sur fond transparent
           *   Fanart - Background l'illustration de personnage plein cadre
           *
           * C'est ce couple qui fait l'image d'ARTFLIX : Samus en pied,
           * son logo pose dessus. Une capture de gameplay a la place donne
           * un resultat tout autre.
           *
           * Le catalogue compte pres de 500 000 images ; un test de
           * sous-chaine avant toute expression reguliere evite d'en
           * compiler une par bloc.
           */
          const estLogo = bloc.includes('<Type>Clear Logo</Type>');
          const estFond = bloc.includes('<Type>Fanart - Background</Type>');
          if (!estLogo && !estFond) continue;

          const id = champ(bloc, 'DatabaseID');
          const fichier = champ(bloc, 'FileName');
          if (!id || !fichier) continue;
          // Un jeu en a souvent plusieurs ; la premiere suffit
          const cible = estLogo ? logos : fonds;
          if (!cible.has(id)) cible.set(id, fichier);
        }
      }
      // Garde-fou : sans balise fermante, `reste` gonflerait indéfiniment
      if (reste.length > 4e6) reste = reste.slice(-2e6);
    });
    flux.on('end', () => {
      // Les <GameImage> viennent apres les <Game> : le rattachement se fait ici
      let avecLogo = 0;
      let avecFond = 0;
      for (const jeu of jeux) {
        const l = logos.get(jeu.DatabaseID);
        if (l) { jeu.Logo = l; avecLogo += 1; }
        const f = fonds.get(jeu.DatabaseID);
        if (f) { jeu.Fanart = f; avecFond += 1; }
      }
      console.log(`[launchbox] ${lus} jeux lus, ${jeux.length} retenus sur tes plateformes`);
      console.log(`[launchbox] logos : ${logos.size} au catalogue, ${avecLogo} sur tes jeux`);
      console.log(`[launchbox] fonds : ${fonds.size} au catalogue, ${avecFond} sur tes jeux`);
      resolve(jeux);
    });
  });
}

const ENTITES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

/* Une expression par nom de champ, gardee : l'indexation en fait plusieurs
   centaines de milliers d'appels. */
const MOTIFS = new Map();

function champ(bloc, nom) {
  if (!MOTIFS.has(nom)) MOTIFS.set(nom, new RegExp(`<${nom}>([\\s\\S]*?)</${nom}>`));
  const m = bloc.match(MOTIFS.get(nom));
  if (!m) return '';
  return m[1]
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, (e) => ENTITES[e])
    .trim();
}

async function main() {
  const force = process.argv.includes('--force');
  if (fs.existsSync(DEST) && !force) {
    const age = (Date.now() - fs.statSync(DEST).mtimeMs) / 86400000;
    console.log(`[launchbox] index déjà présent (${age.toFixed(0)} j). --force pour refaire.`);
    return;
  }

  fs.mkdirSync(TMP, { recursive: true });
  const zip = path.join(TMP, 'Metadata.zip');
  if (!fs.existsSync(zip) || fs.statSync(zip).size < 50e6) telecharger(zip);

  console.log('[launchbox] extraction…');
  const xml = extraire(zip, TMP);

  console.log('[launchbox] indexation…');
  const jeux = await indexer(xml);

  fs.writeFileSync(DEST, JSON.stringify(jeux));
  const mo = fs.statSync(DEST).size / 1e6;
  console.log(`[launchbox] index écrit : ${DEST} (${mo.toFixed(1)} Mo)`);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('[launchbox] fichiers temporaires supprimés');
}

main().catch((err) => {
  console.error('[launchbox]', err.message);
  process.exit(1);
});
