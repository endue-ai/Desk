> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../CONTRIBUTING.md) fait foi.

# Contribuer à endue Desk

Merci de votre aide. Commencez par `AGENTS.md` : il contient la carte du dépôt, les commandes et les règles
communes aux humains et aux agents IA.

## Avant de commencer

- Pour tout ce qui dépasse la simple coquille, ouvrez d'abord une issue afin de convenir du périmètre avant
  d'écrire du code.
- Les questions vont dans GitHub Discussions ; les signalements de sécurité suivent `SECURITY.md`.

## Commandes

Tout le travail passe par `just`, le même point d'entrée que celui de la CI :

```bash
just dev       # run the desktop app
just test      # unit tests (Rust and TypeScript)
just check     # formatting, lints and types
just codegen   # regenerate types from specs/
```

Lancez `just check && just test` avant chaque push.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/) : `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `build:`, `ci:`, `chore:`, avec une portée facultative comme `feat(runtime):`. Les notes de
  version et les numéros de version sont générés à partir de ces messages.
- [Developer Certificate of Origin](https://developercertificate.org/) : apposez un sign-off sur chaque
  commit avec `git commit -s`. Le sign-off certifie que vous êtes l'auteur de la modification ou que vous avez
  le droit de la soumettre sous Apache-2.0. Les commits sans sign-off ne peuvent pas être fusionnés.

## Pull requests

- Un seul sujet par PR. Gardez-la assez petite pour être lue en quelques minutes.
- Les fichiers restent sous les 400 lignes ; découpez un fichier avant qu'il ne dépasse cette taille.
- Remplissez le modèle de PR, y compris le tableau As-is → To-be : les relecteurs lisent d'abord le tableau.
- Les modifications de spec passent en premier dans la PR : modifiez `specs/`, lancez `just codegen`, puis
  implémentez.
- Les tests se trouvent à côté du code source. Une PR qui modifie un comportement ajoute ou modifie un test
  qui échoue sans elle.
- Les PR sont fusionnées en squash : le titre de la PR devient le message de commit et doit donc suivre les
  Conventional Commits.

## Licence

En contribuant, vous acceptez que votre contribution soit distribuée sous licence Apache-2.0. Les fichiers de
`brand/` ne sont pas ouverts aux contributions ; voir `TRADEMARK.md`.
