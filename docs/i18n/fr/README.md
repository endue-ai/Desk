> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../README.md) fait foi.

# endue

Une app qui est à elle seule un OS.

**Aucun écran figé.** endue, c'est un shell Rust sur Chromium et un petit cœur Rust surmontés d'un runtime web, et toutes
les fonctionnalités au-dessus, y compris celles intégrées d'origine, sont des plugins que vous pouvez remplacer
pendant que l'app tourne. Comme Emacs : le cœur ne garde que des primitives (fichiers, processus, réseau,
audio, fenêtres), et tout le reste est du code que vous pouvez modifier sans redémarrer.

> Statut : pré-alpha. `just dev` ouvre le bureau avec Eris et le premier lancement ; lancez d'abord `just brain-echo` et elle répond à ce que vous tapez (un simple écho pour l'instant).

<!-- Capture d'écran : ajoutée avec la scène du premier lancement. -->

## Installer ou mettre à jour l’application endue

L’application graphique Desk s’appelle désormais endue. La [version v0.3.0](https://github.com/endue-ai/endue/releases/tag/v0.3.0) propose deux images disque macOS, pour puce Apple (`aarch64`) ou processeur Intel (`x86_64`). Comparez le SHA-256 de l’image qui correspond à votre Mac avec celui indiqué dans `SHA256SUMS-macos` sur la page de la version, puis ouvrez l’image et copiez endue Desk dans le dossier Applications. La version v0.3.0 n’a pas été notariée par Apple. Si macOS bloque la première ouverture de l’application vérifiée, choisissez « Ouvrir quand même » pour endue Desk dans Réglages Système → Confidentialité et sécurité.

Dès la parution de la première version de bureau nommée **endue app**, choisissez dans les [versions sur GitHub](https://github.com/endue-ai/endue/releases) le programme d’installation adapté à votre système et à votre processeur, puis suivez les étapes ci-dessous.

- Sous macOS, quittez Desk, ouvrez le nouveau fichier `.dmg` et lancez `Install endue.command`. Le programme retrouve dans Applications la copie existante grâce à son identifiant de bundle, même si vous l’avez renommée. Si vous avez plusieurs copies ou une autre application nommée endue, ouvrez un terminal dans l’image disque montée et exécutez `"./Install endue.command" --to "/Applications/Studio.app"`. Remplacez le chemin proposé par celui de votre copie de Desk ou par un nom disponible.
- Sous Windows et Linux, utilisez le même format de paquet que pour votre installation actuelle s’il est proposé. Windows conserve le dossier d’installation. Le paquet Debian s’appelle toujours `endue-desk`.
- Au prochain lancement, l’application retrouve les profils et `plugins.lock` dans `~/.desk`, ainsi que les réglages, les autorisations et les références aux identifiants. Pour une version de Desk distribuée uniquement sous forme d’installeur, comme v0.3.0, effectuez la mise à jour manuellement avec le nouvel installeur.

La commande officielle est `endue`. Depuis les sources, essayez `cargo run -p desk-cli -- --help`. Les images disque de la version v0.3.0 sont antérieures à l’intégration de la CLI. Les scripts existants peuvent continuer à utiliser `desk` pendant la version majeure actuelle.

### Serveurs Linux x86_64

Si une version propose **endue CLI for Linux x86_64**, téléchargez l’archive, sa signature et `SHA256SUMS-cli` dans un répertoire vide. Exécutez `sha256sum -c SHA256SUMS-cli`, puis `tar -xzf endue-cli_*_linux-x86_64.tar.gz`. Donnez à `ENDUE_BRAIN_URL` l’adresse du service brain v0 et lancez `./endue-cli_*/bin/endue run "hello"`. La version v0.3.0 fournit uniquement l’application macOS. [Vérifier la signature de l’éditeur](../../releasing.md#verify-a-linux-cli-download)

## Pourquoi endue

Imaginez le garage d'un bâtisseur : une seule pièce où le bâtisseur travaille au centre, un assistant se
souvient et demande, des bras robotisés font le travail, et chaque mur montre le travail dans la forme
que le bâtisseur veut. endue est ce garage, sur votre ordinateur.

- **Un outil quotidien.** Les bâtisseurs l'ouvrent chaque jour ; il s'installe, démarre et répond avant
  toute autre chose.
- **Natif pour les agents.** Eris, la secrétaire résidente, garde sa propre mémoire sur cet ordinateur et
  orchestre les agents locaux et externes. Les agents ont des mains ; la personne décide.
- **Les vues d'abord.** Organisez les données une fois et dessinez-les dans n'importe quelle forme :
  faites votre propre vue, laissez Eris en faire une à partir d'une phrase, ou installez-en une depuis le
  marché.
- **À vous.** Le système de design, la disposition et les intégrations appartiennent au bâtisseur, qui
  les choisit et les remplace.

endue est un assistant pour les bâtisseurs : il met en place un environnement stable pour construire,
les laisse libres de le façonner, et leur permet de faire le meilleur produit avec une qualité qui ne
faiblit pas. Où en est endue et où il va se trouve dans `docs/roadmap.md`.

### Votre bureau est un dossier

Tout ce que vous façonnez vit dans `~/.desk` : `init.yaml`, vos profils, `keys.yaml`, vos vues et
`plugins.lock`, de simples fichiers à lire, modifier et garder dans git. `endue export <dossier|fichier.zip>`
les emporte vers un autre ordinateur (`--with-data` ajoute l'état propre du bureau, jamais les secrets),
`endue import` les ramène sans écraser votre `init.yaml`, et `endue doctor` liste chaque fichier en disant
s'il se lit comme le veut sa spécification.

## Compilation

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

## Confidentialité

endue n'a aucune télémétrie. Les rapports de plantage, quand ils arriveront, seront soumis à un consentement
explicite et désactivés par défaut.

## En savoir plus

- `docs/architecture.md` : comment les couches s'articulent
- `docs/adr/` : les décisions difficilement réversibles, et pourquoi
- `docs/roadmap.md` : pourquoi endue existe, où il en est et où il va
- `AGENTS.md` : la carte du dépôt, les commandes et les règles (pour les humains comme pour les agents IA)
- `CONTRIBUTING.md` : comment proposer une modification

## Licence

Le code est distribué sous licence [Apache-2.0](../../../LICENSE). Les noms, logos et illustrations endue et
Eris présents dans `brand/` ne le sont pas : voir [brand/LICENSE](../../../brand/LICENSE) et
[TRADEMARK.md](TRADEMARK.md).
