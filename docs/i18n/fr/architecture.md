> Ce document est une traduction. En cas de divergence, la [version anglaise](../../architecture.md) fait foi.

# Architecture d'endue Desk

Ceci est la version française du résumé anglais de la conception. La source de référence est
`docs/ko/desk-structure.md` ; les décisions difficilement réversibles se trouvent dans `docs/adr/`.

Desk est un OS conçu comme une seule app : un shell Tauri et un petit cœur Rust portent un runtime web, et
les fonctions au-dessus de ce runtime, hors réglages et raccourcis, sont des plugins. Comme Emacs, le cœur ne garde que des primitives,
et tout le reste peut être modifié pendant que l'app tourne.

L’interface des réglages, les raccourcis par défaut et la sauvegarde des préférences font partie du cœur du runtime, pas des plugins. Ils restent disponibles sans aucun plugin ; les plugins peuvent ajouter des raccourcis. [ADR 0055](../../adr/0055-core-settings-and-keybindings.md).

Le shell et l'écran changent : Desk passe de Tauri et des webviews de l'OS à un shell Rust sur Chromium
(CEF), puis à un compositeur bien à lui dans lequel chaque fenêtre se rend dans son propre processus
([ADR 0140](../../adr/0140-a-wgpu-compositor-over-cef-off-screen-surfaces.md)). L'étape 1 est en cours ;
d'ici sa sortie, c'est le shell Tauri décrit plus bas qui tourne. « Où vont le shell et l'écran », sous le
tableau des couches, détaille les étapes.

## Vue d'ensemble

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 │              · connectors (Wasm · MCP · http) · views (data)   │
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 │              · UI plugin host · desk shell (until ADR 0026)    │
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge · specs/item · specs/view            │  rebuild
 │              · specs/connector → TS client · Rust types        │
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · item index    │  rebuild
 │              · logic plugin and connector host (Wasm) · VM     │
 │              · built-in connectors · brain clients             │
 ├────────────────────────────────────────────────────────────────┤
 │ Tauri shell  windows · webviews · primitives (fs, proc, net,   │  rebuild
 │              audio)                                            │
 ├────────────────────────────────────────────────────────────────┤
 │ OS           macOS · Windows · Linux (signing, notarisation,   │  —
 │              OS permissions)                                   │
 └────────────────────────────────────────────────────────────────┘
```

Les couches supérieures changent pendant que l'app tourne ; les couches inférieures nécessitent une mise à
jour de l'app. Seul endue AI vit hors de l'appareil. Tout le reste s'exécute sur l'ordinateur de l'utilisateur.

| Couche | Dossiers |
| --- | --- |
| endue AI (cloud) | hors du dépôt ; seuls `specs/brain` et `crates/desk-brain-endue` se trouvent ici |
| Plugins | `plugins/` · `packages/plugin-sdk` · `specs/plugin` · `specs/wit` · `examples/` |
| Runtime web | `packages/runtime` : le compositeur, l'hôte des plugins UI (ADR 0012) et, jusqu'à la décision de l'ADR 0026, le shell du bureau (ADR 0025) · `packages/ui` |
| Pont Desk | `specs/bridge` · `specs/item`, `specs/view` et `specs/connector`, les contrats de la couche d'intégration (ADR 0032) · `packages/bridge` · `crates/desk-bridge` (types générés depuis ces contrats et `specs/plugin`) |
| Cœur Rust | `crates/desk-core`, qui sert aussi la couche d'intégration (`data.*`, `connector.*`, `view.*`, `catalog.get`) et définit les connecteurs intégrés `desk.calendar` et `desk.reminders` sur le calendrier de l'OS (ADR 0036, à l'état de proposition), et exécute les connecteurs http d'après leur manifeste, en lisant lui-même leurs jetons (ADR 0106) · `crates/desk-index`, l'index des éléments dans un seul fichier SQLite (ADR 0033) · `crates/desk-plugin-host`, qui exécute les plugins logiques (ADR 0019) et les connecteurs Wasm (ADR 0034, à l'état de proposition) sur Wasmtime · `crates/desk-vm` · `crates/desk-brain*` |
| Shell Tauri | `apps/desk/src-tauri` · `crates/desk-sys` · `crates/desk-computer`, l'usage de l'ordinateur sous macOS (captures d'écran, l'arbre d'accessibilité, saisie, apps), que le cœur sert en `computer.*` sous `computer:see` et `computer:control` ; chaque action d'un agent attend l'accord de la personne (ADR 0120, ADR 0123) · `apps/desk/shell` et `crates/desk-web`, le shell CEF qui le remplace à la fin de l'étape 1 (ADR 0143) |
| OS | `apps/desk/src-tauri/capabilities` · workflow de publication (signature, notarisation) |

## Où vont le shell et l'écran

Aujourd'hui, Desk est une fenêtre Tauri avec une seule webview de l'OS, et chaque fenêtre de plugin est un
iframe en sandbox dans cette unique page. Le shell et tous les plugins partagent un processus et un fil
principal : un plugin qui boucle bloque tout le bureau, et WebGPU manque sous Linux. L'ADR 0140 change
cela : chaque fenêtre se rend dans son propre processus, et un compositeur propre à Desk, sur wgpu, place
ce qu'elles rendent.

```text
 desk (Rust, one process): winit · compositor (wgpu) · CEF host · core · updater
        │ surface             │ surface             │ surface              │ no surface
 web plugin             web plugin            native plugin          logic plugin
 (CEF renderer)         (WebGPU, 3D)          (its own process)      (Wasm, unchanged)
 each: its own process · its own main thread · its own GPU queue · a crash empties one window
```

| Étape | Ce qui change | État |
| --- | --- | --- |
| 0 | Sur l'app Tauri : chaque surface reçoit sa propre origine sur le schéma `desk-plugin` ; seules les fenêtres visibles et les 8 qui ont eu le focus le plus récemment gardent un cadre vivant ; le travail lourd passe dans des workers ; un cadre qui ne répond plus propose Attendre ou Arrêter sur sa seule fenêtre | en cours |
| 1 | Le shell devient un binaire Rust sur winit et CEF (`apps/desk/shell`, ADR 0143) qui affiche la page actuelle du shell, et Tauri disparaît ; chaque iframe de plugin a son propre processus de rendu Chromium ; les tests e2e de l'app le pilotent par le débogage à distance de Chromium (ADR 0144) | en cours : le shell ouvre sa fenêtre avec CEF (#41) |
| 2 | Le compositeur (`crates/desk-compositor`) dessine le bureau et place la texture de chaque surface ; les surfaces parlent un seul protocole (`specs/surface`, ADR 0141) ; CEF rend chaque plugin hors écran ; le gestionnaire de fenêtres passe de `packages/runtime` à Rust | prévu |
| 3 | Plugins natifs : un processus qui parle le protocole des surfaces et le pont via `desk.sock` | prévu |

Le code des plugins ne change à aucune étape : le manifeste, le SDK et le format du pont restent. Un plugin
gagne son propre processus et sa propre origine, et WebGPU sur tous les OS. Seules les fenêtres visibles et
les 8 qui ont eu le focus le plus récemment gardent un processus vivant ; les autres dorment avec leur état
(ADR 0142). Une preuve de concept sur macOS a composé 30 surfaces CEF hors écran avec wgpu, y a fait tourner
WebGPU, et les autres ont continué à peindre pendant qu'on tuait un processus de rendu ; un processus de
rendu léger coûtait environ 40 MiB (`spikes/compositor/README.md`). Windows et Linux restent à faire.

## Comme Emacs, comme un OS

Emacs exécute presque tout en Elisp au-dessus d'un petit cœur en C, et on peut le modifier pendant qu'il
tourne. Desk adopte la même forme et nomme ses parties comme le ferait un système d'exploitation.

| Rôle | Système d'exploitation | Emacs | Desk |
| --- | --- | --- | --- |
| Noyau | noyau | cœur en C | cœur Rust |
| Appels système | appels système | primitives Lisp | API du pont Desk |
| Pilotes | pilotes de périphériques | code de liaison avec l'OS | shell Tauri + crates Rust |
| Gestionnaire de fenêtres | gestionnaire de fenêtres | frames · windows | compositeur de canevas 3D |
| Shell | shell de terminal | M-x | Eris · palette de commandes |
| Applications | applications | paquets (Elisp) | plugins (UI · Wasm · MCP) |
| Données connectées | systèmes de fichiers montés · index de recherche | backends de Gnus · Org agenda | connecteurs · éléments réunis dans un seul index · vues (ADR 0032) · vues universelles sur toute source d'un même format YAML (ADR 0087) |
| Configuration de démarrage | init | init.el | `init.yaml` (profil + plugins + réglages) |
| Gestionnaire de paquets | apt · brew | package.el · MELPA | place de marché |
| Surcharge de comportement | aucune | advice · hooks | hooks d'événements · surcharges de commandes |
| Comptes | comptes utilisateur | aucun | endue ID |

Six principes en découlent :

1. **Un cœur minimal.** Le cœur Rust contient des primitives (fs, proc, net, audio, ui), pas des
   fonctionnalités.
2. **Les éléments intégrés sont des plugins.** Eris, la barre latérale, la barre d'outils et le changement de
   profil utilisent la même API que les plugins de la communauté : l'API n'a donc pas de trous, et même les
   éléments intégrés peuvent être remplacés. Les politiques par défaut du bureau (placement des surfaces,
   fichiers, thèmes, notifications) sont elles aussi des plugins `desk.*` faits de données
   seulement (ADR 0017). Le shell du bureau (`mountDesk`) ne l'est pas encore : c'est du code dans
   `packages/runtime` (ADR 0025), jusqu'à ce que l'ADR 0026, encore à l'état de proposition, décide de sa
   place. D'ici là, Eris existe deux fois, dans `plugins/eris` et dans le shell (ADR 0027), et les bords du
   bureau aussi : les plugins dock, barre d'outils et barre latérale d'un côté, le bord inférieur, le rail et
   la barre des agents du shell de l'autre (ADR 0028).
3. **Tout est commande.** Les clics, la voix, les raccourcis et les agents appellent les mêmes commandes. Tout
   ce qu'une personne peut faire, Eris et les agents peuvent le faire aussi.
4. **Modifier à chaud.** Enregistrer un plugin le recharge ; l'état du plugin vit dans le stockage du cœur et
   survit au remplacement.
5. **Des hooks partout.** Toute commande peut recevoir des hooks avant et après son exécution, ou être
   remplacée entièrement, comme avec l'advice d'Emacs.
6. **Demander avant de regarder.** Chaque appel de primitive, qu'il vienne d'une personne ou d'un agent, passe
   par la vérification des permissions du pont.

## Ce qui change, et à quelle vitesse

```text
 ┌─ rebuild ──────────────────────────────────────────────────────┐
 │  Rust core · Tauri shell · bridge types   restart after update │
 │  ┌─ restart ────────────────────────────────────────────────┐  │
 │  │  web runtime                         window reload, ~2 s │  │
 │  │  ┌─ instant ──────────────────────────────────────────┐  │  │
 │  │  │  one plugin (iframe · Wasm · MCP)           < 1 s  │  │  │
 │  │  └────────────────────────────────────────────────────┘  │  │
 │  └──────────────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────────────┘
```

Plus on va vers l'intérieur, moins le changement coûte. Pour les utilisateurs, une recompilation se résume à un
redémarrage après une mise à jour automatique ; pour les développeurs, elle implique aussi la compilation, la
signature et la notarisation.

| Portée | Ce qui est rechargé | Objectif | Ce qui continue |
| --- | --- | --- | --- |
| Instantané | le plugin modifié (iframe, instance Wasm ou processus MCP) | moins de 1 s | les autres surfaces, le travail en cours, la veille vocale |
| Redémarrage | le runtime web (rechargement de la fenêtre) | environ 2 s | le cœur Rust, les outils MCP, les CLI en cours d'exécution |
| Recompilation | toute l'app (relance après une mise à jour automatique) | temps de téléchargement + quelques secondes | l'état enregistré, les profils, les plugins installés |

Le développement suit les trois mêmes étapes : les dossiers de plugins se rechargent à l'enregistrement, le
runtime web utilise le HMR de Vite, et le cœur Rust se recompile avec `cargo watch`.

## Contrats

`specs/` trace la frontière entre ouvert et fermé. Les types du pont, du cerveau et des plugins en sont générés
en Rust et en TypeScript, et les deux côtés sont testés avec les mêmes vecteurs. Voir `specs/README.md`.
