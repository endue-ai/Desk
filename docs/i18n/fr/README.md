> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../README.md) fait foi.

<h1 align="center">
  <a href="https://endue.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../../../brand/endue/endue-original-dark-color-lockup.svg">
      <img src="../../../brand/endue/endue-original-light-color-lockup.svg" alt="endue" width="300">
    </picture>
  </a>
</h1>

<div align="center">

**UI Less is Ultimate UI.**

Le bureau open source où chaque app vit sur un seul canevas, où l'IA n'est qu'à une phrase de vous et où
aucun écran n'est figé.

[Site web](https://endue.ai) · [Télécharger](#install) ·
[Les cinq premières minutes](#your-first-five-minutes) · [Écrire un plugin](plugins/authoring.md) ·
[Feuille de route](../../../docs/roadmap.md)

[![Version](https://img.shields.io/github/v/release/endue-ai/endue?label=release)](https://github.com/endue-ai/endue/releases/latest)
[![Licence : Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](../../../LICENSE)
![Plateforme : macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

<a href="#install"><img src="../../../docs/media/readme/hero.gif" alt="Le bureau endue : le canevas défile d'une fenêtre ouverte à l'autre, une phrase tapée les range en mosaïque et change le thème, et Eris dit ce qu'elle a fait" width="100%"></a>

</div>

endue est une app de bureau qui est à elle seule un OS : un terminal, un navigateur, Git, des bases de
données, des documents et vos agents s'ouvrent en fenêtres sur un seul canevas, et Eris, la secrétaire qui y
vit, fait ce que vous demandez dans toutes ces fenêtres. Chaque écran est un plugin que vous pouvez habiller
autrement, réécrire ou retirer pendant que l'app tourne, jusqu'à ce qu'il ne reste que ce dont vous avez
besoin. Le code est sous licence Apache-2.0, il n'y a aucune télémétrie, et l'app fonctionne sans compte.

> [!NOTE]
> endue est jeune et change vite. À partir de la version 0.5.0, l'app macOS, pour puce Apple, est signée,
> notariée et se met à jour elle-même. Les paquets de bureau pour Windows et Linux ne sont pas encore publiés ; sous Linux, il y a
> l'outil en ligne de commande.

## Pourquoi UI Less

L'essentiel de l'interface d'une app est là parce que l'app ne sait pas ce que vous voulez. endue fait trois
pas vers l'interface que vous auriez construite vous-même, puis vous laisse retirer le reste.

### Toutes les apps au même endroit, et une IA à qui demander directement

Vos outils sont les fenêtres d'un seul bureau au lieu d'apps séparées : une seule demande les atteint donc
tous. `Alt+Space` ouvre le champ de conversation : tapez le nom d'une commande pour la lancer, ou dites ce
que vous voulez et Eris le fait avec les commandes du bureau lui-même, en utilisant les fichiers, Git, les
bases de données, le navigateur et les visionneuses par les accès que vous accordez. Elle garde sa mémoire
sur cet ordinateur, demande avant toute action irréversible, et ce qu'elle modifie peut être annulé. Les
programmes d'agents déjà installés ici et vos agents endue travaillent à ses côtés.

<img src="../../../docs/media/readme/ask.gif" alt="Une phrase tapée dans le champ de conversation : Eris place Notes à gauche et le terminal à droite, agrandit le texte des notes et dit ce qu'elle a fait" width="100%">

### Un canevas que l'on parcourt, pas des écrans entre lesquels on bascule

Le bureau est un seul vaste canevas. Les fenêtres restent là où vous les posez et c'est vous qui passez de
l'une à l'autre : faites défiler, ou maintenez Shift et faites glisser, pour parcourir le canevas, et la
carte dans le coin montre où vous êtes. Faites glisser une fenêtre vers un bord pour qu'elle prenne la moitié
de l'écran ou vers un coin pour un quart, étalez tout pour en choisir une, gardez des bureaux séparés pour
des travaux séparés, et sortez n'importe quelle fenêtre dans une fenêtre du système à elle, puis ramenez-la
sur le bureau.

<img src="../../../docs/media/readme/canvas.gif" alt="Le canevas défile vers d'autres fenêtres et revient pendant que la carte suit, une fenêtre glissée vers le bord gauche prend la moitié de l'écran, une autre glissée vers un coin en prend un quart, et les fenêtres s'étalent pour en choisir une" width="100%">

### Façonnez chaque vue et chaque app jusqu'à ce que l'interface disparaisse

Rien à l'écran n'est figé. Changez de thème et de système de design, réaffectez les touches, ou appliquez
votre propre style et votre propre script à la page de n'importe quel plugin, vous-même ou en le demandant à
Eris (« agrandis le texte des notes »). Les vues sont des données, les thèmes sont des valeurs sans code, et
une fonctionnalité intégrée est un plugin au même format de dossier que les vôtres : remplacez-la ou
désactivez-la. Les profils enregistrent un ensemble de plugins, des réglages et une disposition, et l'on
passe de l'un à l'autre en une seule étape.

<img src="../../../docs/media/readme/customize.gif" alt="Le studio de thèmes s'ouvre depuis le champ de conversation, les flèches donnent un aperçu de chaque thème intégré sur tout le bureau, et Enter laisse le bureau dans le thème de terminal ambré" width="100%">

### Déjà inclus

Un terminal, un navigateur, un explorateur de fichiers et des notes ; Git Studio, Docker Studio, API Studio,
un client de bases de données et Image Studio ; des visionneuses pour les feuilles de calcul, les documents,
les présentations, les PDF, les livres numériques, les images, la vidéo, les archives et les données
structurées ; un calendrier, les e-mails, et une seule interface pour toutes les messageries instantanées ;
un client pour les modèles de langage qui tournent sur cet ordinateur. Chacun est un plugin dans
[`plugins/`](../../../plugins/README.md). Pour écrire le vôtre, copiez le plus petit depuis
[`examples/`](../../../examples/README.md) et lancez `just dev` : enregistrer un fichier ne recharge que ce
plugin.

<a id="your-first-five-minutes"></a>

## Vos cinq premières minutes

1. **Installez endue** depuis la [dernière version](https://github.com/endue-ai/endue/releases/latest) et
   ouvrez-le (la section [Installation](#install) donne les détails).
2. **Faites la connaissance d'Eris.** Le premier lancement vous la présente et demande l'accès au microphone
   (**Not now** convient) et un endue ID (**Skip for now** convient : rien n'exige de compte).
3. **Ouvrez quelque chose.** Appuyez sur `Mod+Alt+L` (`Mod` correspond à `Cmd` sous macOS), tapez `term` et
   appuyez sur Enter. Faites de même pour `notes`. `Mod+K` cherche dans les plugins, les commandes, les
   documents et les fichiers en une seule liste.
4. **Déplacez-vous.** Faites défiler, ou maintenez Shift et faites glisser, pour parcourir le canevas.
   Faites glisser le titre d'une fenêtre vers le bord gauche pour lui donner la moitié de l'écran.
5. **Demandez.** Appuyez sur `Alt+Space`, tapez `tile` et appuyez sur Enter, ou dites ce que vous voulez en
   une phrase.
6. **Faites-le vôtre.** Tapez `theme studio` dans le champ de conversation, puis choisissez un thème avec
   les flèches et Enter.

Tout ce que vous façonnez vit dans `~/.desk` : `init.yaml`, vos profils, `keys.yaml`, vos vues et
`plugins.lock`, de simples fichiers à lire, modifier et garder dans git. `endue export <folder|file.zip>`
les emporte vers un autre ordinateur (`--with-data` ajoute l'état propre du bureau, jamais les secrets),
`endue import` les ramène sans écraser votre `init.yaml`, et `endue doctor` liste chaque fichier en disant
s'il se lit comme le veut sa spécification.

<a id="install"></a>

## Installation

| Plateforme | Où l'obtenir |
| --- | --- |
| macOS, puce Apple | L'image disque `darwin-aarch64` de la [dernière version](https://github.com/endue-ai/endue/releases/latest) |
| macOS, processeur Intel | Plus publiée à partir de la version 0.5.0. La [version v0.4.0](https://github.com/endue-ai/endue/releases/tag/v0.4.0) contient la dernière image disque `darwin-x86_64` ; pour une version plus récente, [compilez depuis les sources](#build-from-source) |
| Linux x86_64, ligne de commande | `endue-cli_0.4.0_linux-x86_64.tar.gz` depuis la [version v0.4.0](https://github.com/endue-ai/endue/releases/tag/v0.4.0) |
| Windows, Linux (app de bureau) | Pas encore publié : [compilez depuis les sources](#build-from-source) |

Sous macOS, comparez le SHA-256 de l'image disque avec celui indiqué dans `SHA256SUMS-macos` sur la page de
la version, puis ouvrez l'image et copiez `endue.app` dans Applications. À partir de la version 0.5.0, l'app
propose elle-même les nouvelles versions.

La commande officielle est `endue`. Depuis les sources, essayez `cargo run -p desk-cli -- --help`. Les
scripts existants peuvent continuer à utiliser `desk` pendant la version majeure actuelle.

<details>
<summary>Mettre à jour depuis Desk, ou depuis la version 0.4.0 ou une version antérieure</summary>

L'application graphique Desk s'appelle désormais endue. La version 0.5.0 change l'identifiant de
l'application en `ai.endue.desktop` : elle ne prend donc pas la place d'une copie antérieure et démarre avec
un nouveau profil. Pour conserver un profil antérieur, quittez endue et copiez
`~/Library/Application Support/ai.endue.desk` vers `~/Library/Application Support/ai.endue.desktop` avant le
premier lancement.

La [version endue 0.4.0](https://github.com/endue-ai/endue/releases/tag/v0.4.0) fournit des images disque
macOS pour puce Apple et processeur Intel, et la
[version v0.3.0](https://github.com/endue-ai/endue/releases/tag/v0.3.0) les propose pour puce Apple
(`aarch64`) et processeur Intel (`x86_64`). La version v0.3.0 n'a pas été notariée par Apple. Si macOS bloque
la première ouverture de l'application vérifiée, choisissez « Ouvrir quand même » pour endue Desk dans
Réglages Système → Confidentialité et sécurité.

- Sous macOS, quittez Desk, ouvrez le nouveau fichier `.dmg` et lancez `Install endue.command`. Le programme
  met à jour la copie existante dans Applications, qu'il retrouve grâce à son identifiant de bundle, même si
  vous l'avez renommée. Si vous avez plusieurs copies ou une autre application nommée endue, ouvrez un
  terminal dans l'image disque montée et exécutez
  `"./Install endue.command" --to "/Applications/Studio.app"`. Remplacez le chemin proposé par celui de
  votre copie de Desk ou par un nom disponible.
- Sous Windows et Linux, utilisez le même format de paquet que pour votre installation actuelle s'il est
  proposé. Windows conserve le dossier d'installation. Le paquet Debian s'appelle toujours `endue-desk`.
- Au prochain lancement, l'application retrouve les profils et `plugins.lock` dans `~/.desk`, ainsi que les
  réglages, les autorisations et les références aux identifiants. Pour une version de Desk distribuée
  uniquement sous forme d'installeur, comme v0.3.0, effectuez la mise à jour manuellement avec le nouvel
  installeur. Les images disque de la version v0.3.0 sont antérieures à l'intégration de la CLI.

</details>

<details>
<summary>L'outil en ligne de commande sur les serveurs Linux x86_64</summary>

Téléchargez `endue-cli_0.4.0_linux-x86_64.tar.gz` et `SHA256SUMS-cli` depuis la
[page de la version v0.4.0](https://github.com/endue-ai/endue/releases/tag/v0.4.0) dans un répertoire vide.
Exécutez `sha256sum -c SHA256SUMS-cli`, puis `tar -xzf endue-cli_0.4.0_linux-x86_64.tar.gz`. Définissez
`ENDUE_BRAIN_URL` sur l'adresse de votre service brain v0 et lancez
`./endue-cli_0.4.0_linux-x86_64/bin/endue run "hello"`.
[Vérifier les versions signées de la CLI](../../../docs/releasing.md#verify-a-linux-cli-download)

</details>

## endue et endue.ai

[endue.ai](https://endue.ai) est la plateforme d'agents de la même équipe : des agents qui travaillent pour
vous dans le cloud. Cette app est le bureau open source qui les accueille. Connectez-vous avec un endue ID
et vos agents et espaces endue apparaissent sur le bureau à côté des agents locaux.

La connexion est facultative. Sans compte, Eris tourne sur un modèle présent sur cet ordinateur ou sur un
programme d'agent que vous avez déjà, et tout ce qui se trouve dans ce dépôt fonctionne. endue AI et endue ID
sont des services fermés ; l'app ne les atteint que par le contrat public de
[`specs/brain`](../../../specs/brain).

**Confidentialité.** endue n'a aucune télémétrie. Les rapports de plantage, quand ils arriveront, seront
soumis à un consentement explicite et désactivés par défaut.

## Pourquoi endue

Imaginez le garage d'un bâtisseur : une seule pièce où le bâtisseur travaille au centre, un assistant se
souvient et demande, des bras robotisés font le travail, et chaque mur montre le travail dans la forme que le
bâtisseur veut. endue est ce garage, sur votre ordinateur : un outil quotidien, natif pour les agents, qui
dessine vos données dans n'importe quelle vue et qu'il vous appartient de remodeler. Où il en est et où il va
se trouve dans [`docs/roadmap.md`](../../../docs/roadmap.md).

<a id="build-from-source"></a>

## Compiler depuis les sources

```bash
pnpm install
just check && just test
just dev
```

Il vous faut Rust (la version est fixée dans `rust-toolchain.toml`), Node 22+, pnpm, `just`, ainsi que
cmake et ninja pour le Chromium de l'app (CEF), que son premier build télécharge ; sous Linux, aussi les
en-têtes de GTK 3, xdo, AppIndicator et ALSA. Les tests du runtime tournent dans un Chromium headless de la
version même de l'app, que `just test-e2e` télécharge une fois dans `~/.cache/desk`. Lancez-les avec
`just test-e2e`, jamais avec Playwright directement.

## En savoir plus

| Je veux | Commencer ici |
| --- | --- |
| Écrire un plugin, une vue ou un thème | [`docs/plugins/authoring.md`](plugins/authoring.md), [`examples/`](../../../examples/README.md) |
| Voir ce qui est intégré | [`plugins/`](../../../plugins/README.md) |
| Comprendre comment les couches s'articulent | [`docs/architecture.md`](architecture.md) |
| Savoir pourquoi une décision a été prise | [`docs/adr/`](../../../docs/adr) |
| Voir où va endue | [`docs/roadmap.md`](../../../docs/roadmap.md) |
| Proposer une modification | [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](../../../AGENTS.md) (la carte, pour les humains comme pour les agents IA) |
| Signaler une vulnérabilité | [`SECURITY.md`](SECURITY.md) |

## Licence

Le code est distribué sous licence [Apache-2.0](../../../LICENSE). Les noms, logos et illustrations endue et
Eris présents dans `brand/` ne le sont pas : voir [brand/LICENSE](../../../brand/LICENSE) et
[TRADEMARK.md](TRADEMARK.md).
