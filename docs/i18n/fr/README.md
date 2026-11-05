> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../README.md) fait foi.

# endue Desk

Une app qui est à elle seule un OS.

**Aucun écran figé.** Desk, c'est un shell Tauri et un petit cœur Rust surmontés d'un runtime web, et toutes
les fonctionnalités au-dessus, y compris celles intégrées d'origine, sont des plugins que vous pouvez remplacer
pendant que l'app tourne. Comme Emacs : le cœur ne garde que des primitives (fichiers, processus, réseau,
audio, fenêtres), et tout le reste est du code que vous pouvez modifier sans redémarrer.

> Statut : pré-alpha. `just dev` ouvre le bureau avec Eris et le premier lancement ; lancez d'abord `just brain-echo` et elle répond à ce que vous tapez (un simple écho pour l'instant).

<!-- Capture d'écran : ajoutée avec la scène du premier lancement. -->

## Pourquoi Desk

Imaginez le garage d'un bâtisseur : une seule pièce où le bâtisseur travaille au centre, un assistant se
souvient et demande, des bras robotisés font le travail, et chaque mur montre le travail dans la forme
que le bâtisseur veut. Desk est ce garage, sur votre ordinateur.

- **Un outil quotidien.** Les bâtisseurs l'ouvrent chaque jour ; il s'installe, démarre et répond avant
  toute autre chose.
- **Natif pour les agents.** Eris, la secrétaire résidente, garde sa propre mémoire sur cet ordinateur et
  orchestre les agents locaux et externes. Les agents ont des mains ; la personne décide.
- **Les vues d'abord.** Organisez les données une fois et dessinez-les dans n'importe quelle forme :
  faites votre propre vue, laissez Eris en faire une à partir d'une phrase, ou installez-en une depuis le
  marché.
- **À vous.** Le système de design, la disposition et les intégrations appartiennent au bâtisseur, qui
  les choisit et les remplace.

Desk est un assistant pour les bâtisseurs : il met en place un environnement stable pour construire,
les laisse libres de le façonner, et leur permet de faire le meilleur produit avec une qualité qui ne
faiblit pas. Où en est Desk et où il va se trouve dans `docs/roadmap.md`.

### Votre bureau est un dossier

Tout ce que vous façonnez vit dans `~/.desk` : `init.yaml`, vos profils, `keys.yaml`, vos vues et
`plugins.lock`, de simples fichiers à lire, modifier et garder dans git. `desk export <dossier|fichier.zip>`
les emporte vers un autre ordinateur (`--with-data` ajoute l'état propre du bureau, jamais les secrets),
`desk import` les ramène sans écraser votre `init.yaml`, et `desk doctor` liste chaque fichier en disant
s'il se lit comme le veut sa spécification.

## Compilation

```bash
pnpm install
just check && just test
just dev
```

Il vous faut Rust (la version est fixée dans `rust-toolchain.toml`), Node 22+, pnpm, `just` et les
prérequis Tauri pour votre OS. Sous macOS, les tests du runtime tournent dans un conteneur Linux : il
vous faut aussi Docker Desktop. Sous Linux et Windows, lancez
`pnpm --filter @endue-ai/runtime exec playwright install webkit` une fois. Lancez les tests avec
`just test-e2e`, jamais avec Playwright directement.

## Confidentialité

Desk n'a aucune télémétrie. Les rapports de plantage, quand ils arriveront, seront soumis à un consentement
explicite et désactivés par défaut.

## En savoir plus

- `docs/architecture.md` : comment les couches s'articulent
- `docs/adr/` : les décisions difficilement réversibles, et pourquoi
- `docs/roadmap.md` : pourquoi Desk existe, où il en est et où il va
- `AGENTS.md` : la carte du dépôt, les commandes et les règles (pour les humains comme pour les agents IA)
- `CONTRIBUTING.md` : comment proposer une modification

## Licence

Le code est distribué sous licence [Apache-2.0](../../../LICENSE). Les noms, logos et illustrations endue et
Eris présents dans `brand/` ne le sont pas : voir [brand/LICENSE](../../../brand/LICENSE) et
[TRADEMARK.md](TRADEMARK.md).
