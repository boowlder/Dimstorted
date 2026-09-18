# Dimstorted — V1

Bibliothèque de jeux rétro locale, façon Netflix. Le serveur écoute sur
`127.0.0.1` : rien n'est exposé sur le réseau.

## Démarrer

```bash
./start.sh
```

Démarre le serveur s'il ne tourne pas déjà, et ouvre le navigateur.
`./stop.sh` l'arrête. Le journal est dans `dimstorted.log`.

Ou à la main : `npm start`, puis **http://127.0.0.1:1985**

## Ajouter des jeux : les archives

Les ROMs circulent presque toujours en **`.zip`** — Dimstorted les décompresse
tout seul au moment du scan, puis analyse leur contenu. Rien à faire de ton
côté : dépose les zips, c'est tout.

Un dossier racine redondant (`Jeu.zip` → `Jeu/Jeu/jeu.nes`) est aplati
automatiquement. Les archives déjà traitées apparaissent dans
« fichiers devenus inutiles », avec la place qu'elles occupent et un bouton
pour les supprimer.

🔒 Une archive qui tente d'écrire hors du dossier d'import (*zip slip*) est
**refusée en entier**, et n'est plus reproposée aux scans suivants.

⚠️ `.7z` et `.rar` ne sont pas pris en charge — à décompresser avant dépôt.

## Jeux multi-disques

Un jeu à plusieurs disques affiche un sélecteur **Disque 1 / 2 / 3** dans la
barre du lecteur.

- Si le cœur gère lui-même la pile de disques (fichier `.pbp`, `.m3u`), la
  bascule est **instantanée**.
- Sinon, Dimstorted sauvegarde la partie, recharge l'autre disque et restaure
  l'état — la manœuvre qu'on faisait à la main sur console, en moins pénible.

## Ajouter des jeux

Trois façons, selon le moment :

| Méthode | Quand l'utiliser |
|---|---|
| Déposer dans `D:\GameFLIX\Import\` | Beaucoup de fichiers d'un coup. Scan automatique toutes les 30 s. |
| **Tout valider** | Accepte en lot les détections sûres **et** probables. Seuls les jeux non identifiés restent à arbitrer. |
| Bouton **+ Ajouter des jeux** (glisser-déposer) | Un ou deux fichiers. |
| Champ **Analyser un dossier** | Une collection déjà rangée ailleurs. |

Les fichiers déposés dans `Import` sont **déplacés** dans la bibliothèque une
fois validés. Ceux analysés ailleurs sont **référencés sur place**, sans être
déplacés.

### Identification exacte par CRC32

Les ROMs trouvées au hasard portent souvent des noms fantaisistes :
`Xx_SuPeR.MaRiO.[U].[!]_rip_by_NoBoDy_xX.nes`. Un rapprochement par titre
n'en tirerait rien de bon.

Dimstorted calcule donc le **CRC32** du fichier et le compare aux bases
**No-Intro**, qui recensent taille et CRC de chaque ROM connue. Quand ça
correspond, le titre officiel, la région et le numéro de série sont exacts —
**le nom du fichier n'entre pas en ligne de compte** :

```
Xx_SuPeR.MaRiO.[U].[!]_rip_by_NoBoDy_xX.nes
  → Super Mario Bros. 3 (Europe) (Rev 1) · NES-UM-EUR
```

Actif sur les consoles à cartouche : **NES, SNES, N64, Game Boy, GBA,
Mega Drive, Master System, Game Gear, SG-1000**.

Pas sur les supports optiques : le CRC d'un jeu sur disque porte sur les
pistes brutes, pas sur le fichier `.iso` ou `.chd` — la comparaison n'aurait
aucun sens, et hacher 4 Go à chaque import serait disproportionné.

### La file de validation

Rien n'entre au catalogue sans passer par la file. Chaque entrée affiche son
niveau de confiance et la raison de la détection :

- **SÛR** — signature binaire ou extension sans ambiguïté. *Valider les certains*
  les accepte tous d'un coup.
- **PROBABLE** — heuristique (taille, type de disque). À relire.
- **À CONFIRMER** — non identifié. La console doit être choisie à la main.

Le titre et la console restent modifiables avant validation.

## Ce que Dimstorted sait détecter

La console est déduite de l'extension quand elle est univoque, sinon en lisant
l'en-tête binaire du fichier :

| Cas | Méthode |
|---|---|
| GameCube / Wii | Signature magique à l'offset `0x1C` / `0x18` |
| PS2 | `BOOT2` dans `SYSTEM.CNF` |
| PS1 | Zone système `PLAYSTATION` sans `BOOT2` |
| PSP | Arborescence `PSP_GAME` |
| Dreamcast | En-tête `SEGA SEGAKATANA` |
| Mega-CD | En-tête `SEGADISCSYSTEM` |
| `.chd` | En-tête CHD v4/v5 + métadonnées de pistes CD |
| `.cue` / `.m3u` | Analyse de la première piste référencée |
| `.bin` seul | Taille, ou en-tête si c'est une piste de données |

Les jeux **multi-CD sont fusionnés** en une seule fiche : *Final Fantasy VII
(Disc 1/2/3)* apparaît une fois, avec ses trois disques. Les fichiers
satellites d'un `.cue` suivent automatiquement leur feuille lors du rangement.

## Jaquettes et métadonnées

Dans **+ Ajouter des jeux**, section *Jaquettes et métadonnées* :

- **Compléter les manquantes** — ne traite que les jeux sans visuel
- **Tout refaire** — reprend tout le catalogue de zéro

Aucun compte n'est requis. Les sources sont les dépôts publics libretro :
**libretro-thumbnails** pour les images, **libretro-database** pour le reste.
Les index sont mis en cache 30 jours dans `data/cache/`, donc le deuxième
scraping est quasi instantané.

Trois visuels sont récupérés par jeu : la **jaquette**, une **capture de
gameplay** et l'**écran-titre**.

### Où va quel visuel

| Emplacement | Visuel | Pourquoi |
|---|---|---|
| Vignettes du catalogue | **la jaquette** | C'est l'objet du jeu, ce qu'on reconnaît |
| Bannière d'accueil, fiche | capture de gameplay | Une jaquette portrait étirée en pleine largeur serait ratée |

Les jaquettes n'ont pas toutes le même format — mesuré sur les dépôts :
boîte de cartouche **0,71** (NES 256×350, Mega Drive 483×680, GameCube
512×734), boîtier CD **1,00** (PS1, GBA, Dreamcast en 512×512).

Les vignettes sont donc **en portrait 3/4**, et la jaquette s'y affiche
**entière** sur un fond tiré d'elle-même et flouté. Aucune n'est recadrée :
rogner un boîtier carré dans un cadre portrait amputerait le titre imprimé
sur la boîte, c'est-à-dire exactement ce qu'on vient chercher.

Au survol, la jaquette recule pour laisser la place au panneau d'aperçu, au
lieu d'être masquée par lui.

### Le rapprochement, et pourquoi il peut se tromper

Ta bibliothèque contient « Metal Gear Solid », les bases contiennent
« Metal Gear Solid (France) (Disc 1) ». Le rapprochement est flou, avec
préférence de région (France → Europe → Monde → USA → Japon) et pénalité sur
les versions bêta ou prototype.

Le seuil de certitude est volontairement haut : **mieux vaut pas de jaquette
qu'une mauvaise**. Chaque fiche affiche donc son état :

| État | Signification |
|---|---|
| *(rien)* | Correspondance sûre |
| « Correspondance incertaine » | Trouvée mais à vérifier |
| « Aucune jaquette trouvée » | Rien d'assez proche |

Dans tous les cas, un lien **Chercher la jaquette** ouvre une recherche
manuelle avec aperçus cliquables. Utile pour les titres japonais ou les jeux
dont le nom de fichier est fantaisiste.

### Ce que chaque console reçoit réellement

Vérifié sur les dépôts le 16 septembre 2026 :

| Consoles | Jaquettes | Synopsis | Année · Éditeur · Genre · Joueurs |
|---|---|---|---|
| PS1, PS2, Dreamcast | ✅ | ✅ | ✅ |
| NES, SNES, N64, Game Boy, GBA, Mega Drive, Master System, Game Gear, SG-1000 | ✅ | ❌ | ✅ |
| PSP | ✅ | ❌ | ✅ |
| **GameCube, Mega-CD** | ✅ | ❌ | ❌ |

Deux limites viennent de la source, pas de Dimstorted :

- **Les synopsis sont en anglais** — libretro n'en publie pas en français.
  Une version française viendrait de ScreenScraper.fr, qui exige un compte.
- **L'année manque sur environ 30 % des cartouches.** Le fichier `releaseyear`
  de la NES ne compte que 2280 entrées contre 3295 pour `publisher` :
  *Super Mario Bros. 3* n'y figure tout simplement pas.

## Qualité d'image

Trois réglages, par console, dans l'écran **Commandes**.

**Shaders** — EmulatorJS livre 12 shaders. Les `crt-*` reproduisent une
télévision cathodique : lignes de balayage, léger bombé, halo. C'est
l'image telle qu'elle sortait à l'époque, pas une approximation.

| Famille | Pour quoi |
|---|---|
| `crt-geom`, `crt-aperture`, `crt-lottes`… | Rendu télé cathodique |
| `ScaleHQ 2×/4×`, `SABR`, `Bicubique` | Lissage des contours, sans imiter d'écran |
| Aucun | Pixels bruts |

Le choix vaut pour tous les jeux de la console, et s'applique au lancement
suivant.

**Mise à l'échelle** — les consoles 2D rendent en pixels nets par défaut ;
agrandies avec le lissage du navigateur, elles seraient floues.

**Résolution interne** — la PSP rend en **960×544**, le double du natif
(480×272). ⚠️ Vérifié : ni `mupen64plus_next` (N64) ni `pcsx_rearmed` (PS1)
n'exposent ce réglage.

## Chercher et filtrer

Dès qu'une recherche ou un filtre est actif, l'affichage bascule en **grille**
avec une barre de filtres : console, genre, décennie, nombre de joueurs, et
tri (titre, ajout récent, année, temps de jeu).

Les listes se construisent à partir du contenu réel de ta bibliothèque — pas
de genre proposé si aucun jeu ne le porte.

## Statistiques

Menu **Statistiques** : nombre de jeux et de consoles, temps de jeu total,
place occupée, tes jeux les plus joués, et la répartition du temps par
console. Tout est calculé depuis ce que Dimstorted collecte déjà.

## Jeu au hasard

Le bouton 🎲 de la barre lance un jeu au hasard parmi ceux jouables dans le
navigateur. Les jeux natifs en sont exclus : ouvrir un émulateur PC sur un
coup de dé serait plus surprenant qu'agréable.

## Captures d'écran

Pendant une partie : bouton **Capturer** ou **`Maj+S`**. L'image vient de
l'émulateur, pas de l'écran — elle contient le jeu seul, sans l'interface
autour.

Les captures s'affichent sur la fiche du jeu. Chacune peut être **promue en
jaquette** (★) : c'est alors ton image qui représente le jeu, et le scraping
ne l'écrasera pas.

## Codes de triche

Chargés automatiquement depuis la base publique **libretro**, et présentés
dans le menu de l'émulateur — Dimstorted ne refait pas d'interface, EmulatorJS
a la sienne.

Les fichiers `.cht` suivent la convention No-Intro, la même que les jaquettes.
Deux écarts fréquents sont rattrapés :

- le nom de la jaquette porte parfois un tag absent du fichier de codes
  (`(Mega Drive Mini)`, `(Alternate)`) — les tags de fin sont retirés un à un ;
- les bases écrivent `Story of Thor, The` là où Dimstorted affiche
  `The Story of Thor` — la forme inversée est aussi essayée.

Sur une bibliothèque de 12 jeux jouables en navigateur, 8 ont des codes.
Les consoles à disque en ont nettement moins que les cartouches.

## Sauvegarde de la bibliothèque

Onglet **Bibliothèque → Sauvegarder**. Crée une archive datée dans
`D:\GameFLIX\Sauvegardes\`, et ne garde que les 10 dernières.

Contenu : catalogue, sauvegardes de parties, temps de jeu, listes, titres
corrigés, jaquettes, et toute la configuration (émulateurs approuvés,
commandes, réglages d'image).

**Pas les fichiers de jeu** — ils pèsent des gigaoctets et tu les as déjà.
Une restauration remet le catalogue en place ; si les jeux ont disparu du
disque, Dimstorted le signale.

La base étant en mode WAL, un point de contrôle est forcé avant la copie :
sans lui, les dernières parties resteraient dans le journal et manqueraient
à l'archive.

## Commandes

Menu **Commandes** dans la barre du haut. Clique sur un bouton, appuie sur la
touche à lui donner.

**Un profil par console**, pas par jeu. EmulatorJS range ses réglages dans le
`localStorage` du navigateur et **par titre** : il faudrait tout remapper à
chaque jeu, et rien ne suivrait d'un appareil à l'autre. Dimstorted stocke donc
les profils côté serveur et les injecte au chargement.

Les boutons portent le nom **de la console concernée** : le même bouton
s'appelle *A* sur NES, *Croix* sur PlayStation et *A* sur Mega Drive. Seuls
les boutons réellement présents sur la console sont proposés.

Par défaut : **ZQSD** pour les directions, main droite sur les actions
(clavier AZERTY). Une manette branchée est reconnue directement par
l'émulateur.

## Mode TV

Menu **Mode TV** : plein écran, interface agrandie pour être lue depuis un
canapé, et navigation à la manette.

| Commande | Action |
|---|---|
| Croix directionnelle / stick | Se déplacer entre les jeux |
| Bouton **A** | Ouvrir la fiche, lancer le jeu |
| Bouton **B** | Revenir en arrière |
| Flèches du clavier | Même navigation, sans manette |

Pendant une partie, la manette appartient **au jeu** : Dimstorted cesse de
l'écouter pour ne pas faire défiler le catalogue derrière.

## Profils

Un pote débarque, il veut essayer Crash Bandicoot. Sans profils, sa partie
écraserait la tienne et son quart d'heure gonflerait ton temps de jeu.

L'avatar en haut à droite ouvre le menu ; **Gérer les profils** permet d'en
créer jusqu'à six, chacun avec son nom et sa couleur. Dès qu'il y en a deux,
Dimstorted pose la question **« Qui joue ? »** à l'ouverture — une fois par
onglet, pas à chaque retour sur l'accueil.

**Ce qui appartient à un profil :**

| | |
|---|---|
| Sauvegardes d'état | emplacements 0 à 9, dossiers séparés sur le disque |
| Captures d'écran | galerie de la fiche |
| Temps de jeu et dernière partie | statistiques, rangée *Reprendre* |
| Ma liste | |

**Ce qui reste commun :** le catalogue, les jaquettes, les métadonnées, les
commandes, les réglages d'image et les émulateurs approuvés. Ce sont des faits
sur la machine, pas des goûts — les redemander à chaque invité serait absurde.

Le profil actif est tenu **par le serveur**, pas par le navigateur : le lecteur
tourne dans une iframe isolée, et lui faire transporter un identifiant de profil
à chaque appel aurait suffi à ce qu'un oubli écrase une partie. Conséquence
assumée : changer de profil sur la TV le change aussi sur le PC.

Supprimer un profil efface ses sauvegardes, ses captures et son temps de jeu —
et rien d'autre. Le dernier profil ne peut pas être supprimé.

Les données d'avant les profils ont été reprises automatiquement dans le profil
**Joueur 1** au premier démarrage, fichiers sur le disque compris.

```bash
node scripts/smoke-profiles.js
```

Ce script travaille sur une **copie** de la base, dans un dossier jetable. Il y
reconstitue un état d'avant les profils, applique la migration et vérifie les
deux garanties qui cassent en silence : que rien n'est perdu, et que deux
profils ne se voient pas.

## Reprendre la partie

Tu fermes l'onglet au milieu d'un niveau. Tu reviens trois semaines plus tard,
tu cliques, **tu es exactement là où tu t'étais arrêté.**

- **Sauvegarde automatique** à chaque sortie — bouton *Quitter*, touche `Échap`,
  onglet masqué, ou même onglet fermé brutalement (via `sendBeacon`).
- La rangée **Reprendre la partie** signale ces jeux par un bandeau
  *▶ Reprendre*. La vignette reste la jaquette du jeu ; **la capture de ta
  propre partie** s'affiche sur la fiche, en face de chaque emplacement de
  sauvegarde — là où elle sert vraiment à s'y retrouver.
- Le bouton principal de la fiche devient **Reprendre**, accompagné de
  **Recommencer** pour repartir de zéro.

### Sauvegardes manuelles

| Emplacement | Rôle |
|---|---|
| **0** | Reprise automatique — réécrite à chaque sortie |
| **1 à 9** | Manuels — jamais écrasés automatiquement |

Pendant une partie : bouton **Sauvegarder** ou **`Ctrl+S`** (le raccourci est
relayé depuis le lecteur, qui a le focus). Chaque sauvegarde garde sa capture
d'écran et sa date, et se recharge d'un clic depuis la fiche.

Les états vivent sur le SSD dans `data/saves/`, à côté de la base — ils sont
petits et sollicités souvent.

⚠️ Les états de sauvegarde sont **liés au cœur d'émulation**. Si EmulatorJS
change de version de cœur, d'anciens états peuvent devenir illisibles. Pour une
partie à laquelle tu tiens, utilise aussi la sauvegarde interne du jeu.

## Fangames et homebrews

Deux catégories très différentes, à ne pas confondre :

### Les homebrews — ça marche déjà

Un homebrew est une **vraie ROM** écrite pour la console. Il s'importe et se
joue exactement comme les autres, sans rien de particulier. Beaucoup sont
librement distribués par leurs auteurs.

⚠️ Les conditions varient d'un projet à l'autre : certains dépôts autorisent
le téléchargement mais **pas la rediffusion**. Lire la page du jeu avant de
partager.

### Les fangames — une plateforme à part

Un fangame **n'est pas une ROM** : c'est un jeu PC. Sonic Robo Blast 2, par
exemple, est un exécutable Windows/Linux sous GPL v2 — aucun émulateur ne peut
le lancer. Dimstorted distingue donc deux plateformes :

| Plateforme | Ce que c'est | État |
|---|---|---|
| **Fangame navigateur** | Le jeu a une version web (`index.html` + assets) | ✅ Joue dans le navigateur |
| **Fangame PC** | Un exécutable (`.exe`, `.love`, `.jar`…) | 📋 Catalogué, lancement en V3 |

Un jeu HTML5 est **un dossier, pas un fichier**. Dépose le dossier entier dans
`Import` : Dimstorted repère son `index.html`, prend le **nom du dossier** comme
titre, et déplace toute l'arborescence — scripts, images et sons compris.

### Saisie manuelle

Aucune base libretro ne référence les fangames. Ils sont donc marqués
*à saisir à la main*, et leur fiche propose **Modifier la fiche** : titre,
année, genre, joueurs, développeur, éditeur, description et jaquette
personnalisée. Le scraping automatique ne les touche pas et n'écrasera jamais
ce que tu as saisi.

Un champ vidé efface la valeur ; une année ou un nombre de joueurs aberrant
est refusé plutôt que d'effacer ce qui était correct.

### Sur la légalité

Sega a **officiellement** déclaré tolérer les fangames Sonic non monétisés.
Mais « toléré » n'est pas « autorisé » : Sega a fait retirer *Streets of Rage
Remake* par mise en demeure, et d'autres éditeurs — Nintendo en tête — sont
nettement moins conciliants. Ça se juge projet par projet.

## Éditions régionales et doublons

Un même jeu existe souvent en plusieurs versions. Dimstorted les regroupe en
**une seule fiche** portant plusieurs *éditions* — à ne jamais confondre avec
les *disques* d'un jeu multi-CD :

```
Resident Evil 2
  ├─ édition France  ─ disque 1, disque 2   ← jouée par défaut
  ├─ édition USA     ─ disque 1, disque 2
  └─ édition Japon   ─ disque 1, disque 2
```

L'ordre de priorité par défaut est **France → Europe → Monde → USA → Japon**,
modifiable dans *+ Ajouter des jeux → Éditions régionales*. La première
disponible se lance ; les autres restent accessibles d'un clic sur la fiche,
ou supprimables une par une.

### Ce qui compte comme doublon

Un doublon, c'est **le même jeu, la même région, le même disque**. Une autre
région est une édition légitime, jamais un doublon. Les vrais doublons sont
refusés à l'import avec un message explicite, écartés de la file (ils ne
reviennent pas au scan suivant) et regroupés en bas de l'écran d'ajout, avec
la place qu'ils occupent et un bouton pour les supprimer.

Cela se règle avec `rejectDuplicates` dans `config.json`.

### Exclusivités régionales

Un jeu dont aucune sortie occidentale n'est recensée porte un badge
**EXCLU 🇯🇵** — c'est ce qui justifie de garder une version japonaise dans une
bibliothèque autrement francophone. L'information est vérifiée sur les bases
**No-Intro** et **Redump**, pas devinée.

⚠️ La réponse porte sur *ce titre*. Beaucoup de jeux japonais sont sortis en
Occident sous un autre nom : *Bare Knuckle III* est signalé exclusivité Japon,
ce qui est exact, même si le jeu est connu ici sous le nom *Streets of Rage 3*
(avec des différences de contenu réelles).

## Navigateur ou PC

| Mode | Consoles |
|---|---|
| **Navigateur** | NES, SNES, N64, Game Boy / Color / Advance, Mega Drive, Master System, Game Gear, SG-1000, Mega-CD, PS1, PSP |
| **Navigateur (sans émulateur)** | Fangames HTML5 |
| **PC (natif)** | PS2, GameCube, Dreamcast, Fangames PC |

Les trois dernières n'ont pas de cœur WebAssembly disponible — vérifié sur le
CDN EmulatorJS : `flycast` et `mednafen_saturn` sont absents. Leurs jeux sont
catalogués et rangés, mais le lancement via PCSX2 / Dolphin / Flycast arrive
en **V3**.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `Ctrl+K` | Palette — tape un titre, Entrée, le jeu se lance |
| `/` | Recherche |
| `Ctrl+S` | Sauvegarde manuelle pendant une partie |
| `Échap` | Quitte la partie (en sauvegardant), ferme la fiche ou l'écran d'ajout |

## Lancer sur le PC (V3)

PS2, GameCube, Dreamcast et les fangames PC ne tournent pas dans le
navigateur. Dimstorted les lance depuis ton PC, sous trois règles strictes.

### Installation actuelle

Les trois émulateurs sont installés en **mode portable** dans
`D:\GameFLIX\Emulateurs\`, avec leurs BIOS au bon endroit :

| Émulateur | Version | BIOS |
|---|---|---|
| PCSX2 | 2.8.2 | `PCSX2\bios\` + `portable.ini` |
| Dolphin | 2606a | aucun requis |
| Flycast | 2.7 | `Flycast\data\` |

⚠️ Chaque émulateur cherche ses BIOS **dans son propre dossier**, pas dans
`D:\GameFLIX\BIOS\`. Ce dernier ne sert qu'au diagnostic de Dimstorted — les
copies de travail sont dans les dossiers des émulateurs. Sans le
`portable.ini`, PCSX2 irait lire `Documents\PCSX2\` et ne trouverait rien.

### Installer un autre émulateur

**Dimstorted ne télécharge ni n'installe rien.** Tu installes l'émulateur
depuis sa source officielle, puis tu indiques son chemin dans
*+ Ajouter des jeux → Émulateurs PC*.

| Émulateur | Console | Source officielle | Licence |
|---|---|---|---|
| **PCSX2** | PS2 | [pcsx2.net/downloads](https://pcsx2.net/downloads/) | LGPL / GPL |
| **Dolphin** | GameCube | [dolphin-emu.org/download](https://dolphin-emu.org/download/) | GPL-2.0 |
| **Flycast** | Dreamcast | [github.com/flyinghead/flycast/releases](https://github.com/flyinghead/flycast/releases) | GPL-2.0 |
| **RetroArch** | secours | [retroarch.com](https://www.retroarch.com/?page=platforms) | GPL-3.0 |

Les arguments de ligne de commande sont ceux documentés par chaque projet, et
restent modifiables via `emulatorArgs` dans `config.json` si un projet change
sa CLI.

### Les trois règles

**1. Rien n'est lancé qui n'ait été approuvé.** Le serveur n'accepte jamais un
chemin transmis dans une requête : il ne connaît que des identifiants, résolus
dans sa propre configuration. Enregistrer un émulateur est le seul moment où
un chemin entre dans le système — et il y entre approuvé.

**2. L'empreinte est revérifiée à chaque lancement.** Le SHA-256 relevé à
l'enregistrement est recalculé avant d'exécuter. Si le binaire a changé, le
lancement est **refusé** et l'interface affiche un avertissement. C'est ce qui
rend Dimstorted plus sûr qu'un double-clic : un double-clic, lui, ne remarque
rien.

**3. Aucun shell, jamais.** `spawn` reçoit un tableau d'arguments. Un jeu nommé
`Sonic"; rm -rf ~` est transmis tel quel à l'émulateur, comme un simple nom de
fichier.

### Fangames PC

Un fangame est un programme à part entière : il doit être **approuvé
nommément**, jeu par jeu, et son fichier doit se trouver dans la bibliothèque.
Son empreinte est relevée puis revérifiée comme pour un émulateur.

⚠️ **Ce que Dimstorted ne peut pas faire :** rendre sûr un binaire dont tu ignores
la provenance. Lancer un `.exe` inconnu depuis Dimstorted reste aussi risqué que
de double-cliquer dessus. La garantie porte sur le fait que rien ne se lance
sans ton accord explicite, et que rien ne change dans ton dos.

## Sécurité

Hors du lancement natif décrit ci-dessus, Dimstorted **n'exécute aucun
programme**. Le serveur sert des fichiers, écrit dans SQLite et télécharge des
jaquettes. Seul `npm run offline` lance un programme externe (`7z`), à ta
demande.

| Protection | État |
|---|---|
| Écoute réseau | `127.0.0.1` seulement — rien n'est exposé |
| Remontée de dossier à l'upload | Bloquée (`path.basename`) |
| Remontée de dossier sur les jeux web | Bloquée (403) |
| Requêtes venues d'autres sites | Refusées (403) sur toute écriture |

**Sur ce dernier point** : même en n'écoutant que sur `127.0.0.1`, le serveur
reste joignable depuis n'importe quelle page ouverte dans ton navigateur. Un
formulaire caché vers `http://127.0.0.1:1985` part sans contrôle préalable dès
lors qu'il est en multipart. Toute requête modifiante portant une origine
étrangère est donc refusée. Les lectures restent libres : elles ne peuvent
rien casser.

### Avant d'ouvrir l'accès au réseau local

Si tu passes `host` à `0.0.0.0` pour jouer depuis la tablette, **n'importe
quelle machine du réseau pourra piloter Dimstorted**. À ce moment-là il faudra
une authentification — et surtout ne pas activer le lancement natif sans elle.

## Configuration

`config.json` est créé au premier démarrage.

```json
{
  "port": 1985,
  "host": "127.0.0.1",
  "gamesPath": "/mnt/d/Dimstorted/Games",
  "importPath": "/mnt/d/Dimstorted/Import",
  "biosPath": "/mnt/d/Dimstorted/BIOS",
  "dataPath": "./data",
  "emulatorSource": "cdn",
  "autoScanInterval": 30,
  "regionPreference": ["France", "Europe", "Monde", "USA", "Japon"],
  "rejectDuplicates": true
}
```

Répartition volontaire : les **jeux sur le HDD** (gros fichiers lus
séquentiellement), la **base et les jaquettes sur le SSD** (petits fichiers
lus en permanence, l'interface doit rester instantanée).

### Préchauffer le cache

```bash
node scripts/warm-cache.js
```

Télécharge à l'avance les index de jaquettes et de métadonnées. Sans ça, ton
premier scraping passe plusieurs minutes à les récupérer. **Déjà fait** pour
tes 11 consoles : 48 130 jaquettes indexées, 24 Mo de cache, valable 30 jours.

### Fonctionner 100 % hors ligne

Par défaut, le moteur EmulatorJS vient de son CDN — les jeux, eux, ne quittent
jamais la machine. Pour supprimer aussi cette dépendance :

```bash
npm run offline
```

Télécharge le paquet complet (~290 Mo, tous les cœurs) dans
`public/emulatorjs/` et bascule `emulatorSource` sur `local`.
Nécessite `7z` (`sudo apt install p7zip-full`).

### BIOS

À déposer dans `D:\GameFLIX\BIOS\`. `/api/status` signale ceux qui manquent
pour les consoles déjà présentes au catalogue.

| Console | BIOS |
|---|---|
| PS2 | Obligatoire |
| Dreamcast | Obligatoire (`dc_boot.bin`, `dc_flash.bin`) |
| Mega-CD | Obligatoire |
| PS1 | Optionnel — le cœur a une émulation interne |
| Toutes les autres | Aucun |

## Vérifier que tout marche

Une ROM NES de test est fournie au catalogue (*Dimstorted Test*). Elle affiche un
écran bleu uni : si tu le vois, toute la chaîne fonctionne. Tu peux la
supprimer depuis sa fiche.

Pour rejouer le test automatiquement :

```bash
npm run smoke -- 'http://127.0.0.1:1985/player.html?id=1' /tmp/test.png
```

## Limites connues
- Les jeux multi-CD se lancent sur le disque 1 ; le changement de disque en
  cours de partie arrive avec le support `.m3u` complet.
- Les archives `.7z` et `.rar` ne sont pas décompressées (`.zip` l'est).
- L'interface d'EmulatorJS est en anglais : la traduction française n'est pas
  publiée sur leur CDN.

## Structure

```
server/
  config.js     chemins et réglages
  consoles.js   catalogue des consoles, extensions, cœurs
  detect.js     détection par extension et en-tête binaire
  titles.js     nettoyage des noms de fichiers
  importer.js   scan, file de validation, rangement
  db.js         SQLite
  saves.js      sauvegardes d'état, emplacements, reprise
  archives.js   décompression .zip en flux, protection zip-slip
  controls.js   profils de commandes par console, validation
  launcher.js   lancement natif : approbation, empreintes, spawn
  emulators.js  catalogue des émulateurs et sources officielles
  editions.js   éditions régionales, préférence, doublons
  index.js      API et service des fichiers (requêtes Range)
  scrapers/
    releases.js   sorties officielles No-Intro / Redump (exclusivités)
    match.js      rapprochement flou des titres
    thumbnails.js images libretro-thumbnails
    metadata.js   métadonnées libretro-database (DAT)
    systems.js    correspondance consoles Dimstorted ↔ libretro
    cache.js      cache disque des index, 30 jours
    index.js      orchestrateur et suivi de progression
public/
  index.html    interface
  player.html   lecteur, isolé en iframe
scripts/
  make-fixtures.js       fichiers-témoins pour tester la détection
  make-test-rom.js       ROM NES minimale, réellement exécutable
  smoke-player.js        test de bout en bout dans un vrai navigateur
  vendor-emulatorjs.js   bascule en mode hors ligne
```
