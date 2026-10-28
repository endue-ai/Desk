> Ce document est une traduction. En cas de divergence, la [version anglaise](../../architecture.md) fait foi.

# Architecture d'endue Desk

Ceci est la version française du résumé anglais de la conception. La source de référence est
`docs/ko/desk-structure.md` ; les décisions difficilement réversibles se trouvent dans `docs/adr/`.

Desk est un OS conçu comme une seule app : un shell Tauri et un petit cœur Rust portent un runtime web, et
chaque fonctionnalité au-dessus de ce runtime est un plugin. Comme Emacs, le cœur ne garde que des primitives,
et tout le reste peut être modifié pendant que l'app tourne.

## Vue d'ensemble

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge → TS client · Rust traits            │  rebuild
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · plugin host   │  rebuild
 │              · VM · brain clients                              │
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
| Runtime web | `packages/runtime` · `packages/ui` |
| Pont Desk | `specs/bridge` · `packages/bridge` · `crates/desk-bridge` |
| Cœur Rust | `crates/desk-core` · `crates/desk-plugin-host` · `crates/desk-vm` · `crates/desk-brain*` |
| Shell Tauri | `apps/desk/src-tauri` · `crates/desk-sys` |
| OS | `apps/desk/src-tauri/capabilities` · workflow de publication (signature, notarisation) |

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
   touches, fichiers, thèmes, notifications) sont elles aussi des plugins `desk.*` faits de données
   seulement (ADR 0017).
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
