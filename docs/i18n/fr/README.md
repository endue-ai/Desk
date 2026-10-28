> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../README.md) fait foi.

# endue Desk

Une app qui est à elle seule un OS.

**Aucun écran figé.** Desk, c'est un shell Tauri et un petit cœur Rust surmontés d'un runtime web, et toutes
les fonctionnalités au-dessus, y compris celles intégrées d'origine, sont des plugins que vous pouvez remplacer
pendant que l'app tourne. Comme Emacs : le cœur ne garde que des primitives (fichiers, processus, réseau,
audio, fenêtres), et tout le reste est du code que vous pouvez modifier sans redémarrer.

> Statut : pré-alpha. `just dev` ouvre le bureau avec Eris et le premier lancement ; lancez d'abord `just brain-echo` et elle répond à ce que vous tapez (un simple écho pour l'instant).

<!-- Capture d'écran : ajoutée avec la scène du premier lancement. -->

## Compilation

```bash
pnpm install
just check && just test
just dev
```

Il vous faut Rust (la version est fixée dans `rust-toolchain.toml`), Node 22+, pnpm, `just` et les
prérequis Tauri pour votre OS. Lancez `pnpm --filter @endue-ai/runtime exec playwright install webkit`
une fois pour les tests du runtime.

## Confidentialité

Desk n'a aucune télémétrie. Les rapports de plantage, quand ils arriveront, seront soumis à un consentement
explicite et désactivés par défaut.

## En savoir plus

- `docs/architecture.md` : comment les couches s'articulent
- `docs/adr/` : les décisions difficilement réversibles, et pourquoi
- `AGENTS.md` : la carte du dépôt, les commandes et les règles (pour les humains comme pour les agents IA)
- `CONTRIBUTING.md` : comment proposer une modification

## Licence

Le code est distribué sous licence [Apache-2.0](../../../LICENSE). Les noms, logos et illustrations endue et
Eris présents dans `brand/` ne le sont pas : voir [brand/LICENSE](../../../brand/LICENSE) et
[TRADEMARK.md](TRADEMARK.md).
