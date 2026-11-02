> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../plugins/authoring.md) fait foi.

# Écrire un plugin Desk

Un plugin Desk est un dossier. Les fonctionnalités intégrées utilisent exactement le même format : tout ce que
Desk fait lui-même à l'écran, votre plugin peut le faire aussi. Cette page commence par les types de plugins et
leurs modèles, puis traite en détail des plugins UI et, pour finir, des thèmes ; les plugins d'outils (MCP)
viendront plus tard.

## Partir d'un modèle

`create-plugin` crée un dossier d'un type donné, qui passe `desk plugin validate` et contient un test
(`pnpm create @endue-ai/plugin` une fois le paquet publié) :

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --kind ui
cargo run -p desk-cli -- plugin validate ../my-plugin
cargo run -p desk-cli -- plugin test ../my-plugin
```

| Type | Ce que c'est | Exemple |
| --- | --- | --- |
| `ui` | Une page dans un cadre isolé, sur le SDK (le reste de cette page) | `examples/plugin-hello-ui` |
| `logic` | Un composant Wasm du monde `desk:host`, en Rust (ADR 0019) | `examples/plugin-hello-wasm` |
| `connector` | Un composant Wasm du monde `desk:connector` qui importe des éléments (ADR 0034) | `examples/plugin-hello-connector` |
| `view` | Une vue sous forme de données : quoi afficher, depuis quelles sources ; sans code (ADR 0032) | `examples/plugin-hello-view` |
| `policy` | Des commandes, des touches et les autres contributions sous forme de données ; sans code (ADR 0017) | les politiques `desk.*` de `plugins/` |
| `theme` | Les valeurs du design system, avec les polices et les images qu'elles nomment ; sans code (Créer un thème, ADR 0056) | `examples/plugin-hello-theme` |

Les types en Rust se compilent avec la commande propre au langage : `cargo build --release` dans le dossier,
pour la cible `wasm32-wasip2` (`rustup target add wasm32-wasip2` une seule fois). Le composant est produit là
où pointe l'`entry` de `plugin.json`.

Pour voir un plugin dans Desk pendant que vous travaillez dessus, lancez Desk avec votre dossier comme plugin
de développement :

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

Enregistrez n'importe quel fichier du dossier : seul votre plugin se recharge, en moins d'une seconde. Le reste
de Desk, ainsi que l'état de votre plugin, restent tels quels. Un dossier vide ou cassé au démarrage de Desk
apparaît dès que ses fichiers arrivent ou sont corrigés, sans redémarrage.

### Tester avec `desk plugin test`

`desk plugin test <folder>` vérifie le dossier comme le fait `validate`, puis exécute ses `tests/` sur l'hôte
qui correspond à son type :

- `ui`, `view`, `policy`, `theme` et les autres types sans Wasm : `tests/*.test.js` ou `*.test.ts` avec
  vitest sur l'hôte de test du SDK (`@endue-ai/plugin-sdk/testing`, voir Tests plus bas), dans une page
  jsdom. Importez le SDK par son nom et gardez le code testé sans import du SDK, comme le font les modèles
  (`ui/plugin.js`, avec `ui/main.js` qui appelle `defineUiPlugin(plugin)`).
- `logic` et `connector` Wasm : chaque `tests/<name>.test.json` sur un desk scripté, le harnais de
  `desk-plugin-host`, avec le composant compilé :

```json
{
  "steps": ["start", { "command": { "id": "example.my-logic.greet", "args": { "name": "Ada" } } }],
  "answers": [{ "method": "settings.get", "params": { "key": "greeting" }, "result": "Hi" }],
  "expect": {
    "calls": [
      { "method": "cmd.register", "params": { "id": "example.my-logic.greet" } },
      { "method": "cmd.answer", "params": { "result": "Hi, Ada!" } }
    ]
  }
}
```

`steps` décrit ce que fait le desk : `start`, `command` (`id`, `args`) et `event` (`name`, `data`) pour un
plugin de logique, `connect` (`instance`, `settings`) et `sync` (`instance`) pour un connecteur. Chaque import
appelé par le plugin est enregistré comme un appel du bridge, `{ method, params }` (`fs.read { path }`,
`cmd.answer { invocationId, result }`), et reçoit la réponse de la première entrée de `answers` ayant ce
`method` et dont l'appel contient les `params` : avec `result`, ou avec `error`
(`{ "code": "not_found", "message": "…" }`). Un appel sans réponse reçoit la réponse vide : rien, `null`,
`[]` ou un nouvel id ; `store.get` renvoie ce que le plugin a enregistré ; les fichiers et le réseau
répondent `not_found` et `unsupported`. Les appels de `expect.calls` doivent avoir eu lieu dans cet ordre, et
les `expect.items` d'un connecteur doivent figurer parmi les éléments apportés par ses synchronisations ;
chacun correspond dès qu'il contient ce qui est écrit. Un échec nomme ce qui était attendu et liste ce qui est
venu à la place.

## Le dossier

| Chemin | Requis | Rôle |
| --- | --- | --- |
| `plugin.json` | oui | Le manifeste : id, version, kind, entry, permissions, surfaces |
| `ui/index.html` | oui (l'`entry`) | La page que Desk charge dans un cadre en sandbox |
| `ui/*.js`, `ui/*.css` | non | Votre code et vos styles, chargés relativement à l'entrée |
| `README.md` | recommandé | Ce que fait le plugin, quelles permissions il demande et pourquoi |

Le manifeste suit `specs/plugin/v0/plugin.schema.json` :

```json
{
  "id": "example.my-plugin",
  "version": "0.1.0",
  "kind": "ui",
  "entry": "ui/index.html",
  "permissions": [{ "permission": "fs:read", "paths": ["~/Documents/**"] }],
  "surfaces": [{ "id": "main", "title": "My plugin", "placement": "center" }]
}
```

Les id sont en minuscules, au format domaine inversé (`example.my-plugin`). L'entrée reste à l'intérieur du
dossier.

## Le SDK

Importez le SDK via une import map dans votre page d'entrée ; Desk le sert à l'adresse `/_desk/plugin-sdk.js` :

```html
<script type="importmap">
  { "imports": { "@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js" } }
</script>
<script type="module" src="./main.js"></script>
```

```js
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

defineUiPlugin({
  async mount({ pluginId, bridge, state }) {
    const saved = state.get() ?? { count: 0 };   // survives reloads of this surface
    state.set({ count: saved.count + 1 });
    const { grants } = await bridge.call("perm.query", {});
    bridge.onEvent((event) => console.log(event.event));
  },
});
```

`bridge.call(method, params)` atteint le cœur. Les appels effectués dans le même tick partent ensemble dans un
seul message. Un appel refusé est rejeté avec une erreur `BridgeCallError` dont le `code` vaut, par exemple,
`permission_denied`.

## Permissions

Votre cadre s'exécute dans une sandbox qui n'autorise que les scripts : aucun accès à la page de Desk, aucune
navigation de niveau supérieur, ni formulaires ni popups, et aucune connexion réseau propre. Chaque capacité
passe par le pont, et chaque appel au pont, sauf `perm.*`, porte la portée de permission dont il a besoin
(`params.scope`). Le cœur ne répond que si l'utilisateur a accordé une permission qui couvre cette portée.

1. Déclarez dans les `permissions` de `plugin.json` tout ce que vous pourriez demander.
2. Demandez au moment où vous en avez besoin : `bridge.call("perm.request", { permission, reason })`.
3. Passez la portée correspondante avec chaque appel, aussi étroite que possible.

Le vocabulaire (`fs:read`, `fs:write`, `proc:spawn`, `net:fetch`, `audio:capture`, `ui:surface`,
`ui:notify`, `plugin:manage`, `brain:converse`, `cmd:invoke`, `cmd:advise`, `settings:read`, `log:read`,
`events:subscribe`, `perm:manage`, `data:read`, `connector:manage`, `view:manage`) se trouve dans `specs/plugin/v0/README.md`.

## Contributions

Un plugin peut compléter les politiques par défaut du bureau sans code, dans `contributes` de
`plugin.json` (ADR 0017) : des commandes que la palette liste et que des touches lancent, des raccourcis,
des règles d'affichage, les fichiers qu'il ouvre, des thèmes, des réglages avec leur valeur par défaut et
des profils. Les commandes, réglages et thèmes commencent par l'id du plugin.

```json
"contributes": {
  "commands": [{ "id": "example.my-plugin.new", "title": "New note" }],
  "keys": [{ "key": "Mod+Shift+N", "command": "example.my-plugin.new" }],
  "display": [{ "match": { "plugin": "example.my-plugin" }, "area": "right", "size": { "pixels": 360 } }],
  "files": [{ "pattern": "*.md", "plugin": "example.my-plugin" }],
  "settings": { "example.my-plugin.folder": { "kind": "string", "default": "~/notes" } }
}
```

Répondez à vos commandes avec `ctx.commands.on`, et lancez n'importe quelle commande du bureau avec
`ctx.commands.run`. Les deux passent par le registre de commandes du cœur (`cmd.*`) ; lancer une commande
que vous ne fournissez pas demande une permission `cmd:invoke` qui couvre son id, par exemple
`{ "permission": "cmd:invoke", "ids": ["desk.theme.*"] }` :

```js
defineUiPlugin({
  mount(ctx) {
    ctx.commands.on("example.my-plugin.new", async () => "note-1");      // the answer
    ctx.commands.on("desk.files.visit", ({ buffer, path }) => { /* fs.read it, show it */ });
    ctx.commands.on("desk.files.save", ({ buffer, path }) => { /* fs.write it */ });
    document.querySelector("button").onclick = () => ctx.commands.run("desk.theme.toggle");
  },
});
```

Un plugin qui ouvre des fichiers répond à `desk.files.visit`, `desk.files.save` et `desk.files.revert`,
et signale le travail non enregistré avec `desk.buffers.update { id, modified: true }`. Le thème arrive
dans votre cadre sous forme de propriétés CSS `--desk-*` et de `ctx.theme`. Les combinaisons de touches
pressées dans votre cadre atteignent le keymap du bureau, sauf si vous appelez `preventDefault()`. Les
politiques par défaut, et ce que chacune décide, sont listées dans `plugins/README.md`.

## Éléments et vues

Ce que contiennent les applications qu'une personne connecte arrive sur le bureau sous forme d'éléments
d'une seule forme (`specs/item/v0`, ADR 0032) : événements, tâches, messages, notes et plus, de toutes
les sources de la même façon. `ctx.data` lit l'index du bureau avec une permission `data:read` et passe
la portée la plus étroite dont une requête a besoin ; `ctx.views` lit et enregistre les vues de la
personne avec `view:manage` :

```js
const { items } = await ctx.data.query({
  kinds: ["task"],
  where: [{ field: "due", op: "lt", value: "2026-10-31T00:00:00+09:00" }],
});
const stop = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => redraw(changes));
await ctx.commands.run("desk.views.open", { id: "desk.today" });
```

Une vue est une donnée, pas du code (`specs/view/v0`) : le plugin intégré `desk.views` la dessine avec
les éléments de `@endue-ai/ui` (`desk-list`, `desk-table`, `desk-agenda`, `desk-stat`, `desk-markdown`,
`desk-card`), et ses modèles connaissent l'horloge (`{today}`, `{tomorrow}`). Votre page pourra
importer les mêmes éléments (`"@endue-ai/ui": "/_desk/ui.js"` dans sa carte d'import) dès que
l'application les servira ; le serveur de test du runtime le fait déjà.

## Tests

`@endue-ai/plugin-sdk/testing` exécute votre plugin sans navigateur, avec un pont simulé :

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event), host.upsert(item)
```

Avant de publier, `desk plugin validate <folder>` doit réussir ; la CI l'exécute pour chaque dossier de
`plugins/` et `examples/`.

## Créer un thème

Un thème est un plugin de kind `theme` : les valeurs du design system et les fichiers de polices et
d'images qu'elles désignent, sans code, si bien qu'il ne demande aucune permission (ADR 0056, ADR 0057).
Partez du modèle ou de l'exemple :

```bash
pnpm --filter @endue-ai/create-plugin build                       # once
node packages/create-plugin/dist/create-plugin.js ../my-theme --kind theme
DESK_DEV_PLUGINS=$PWD/../my-theme just dev
cargo run -p desk-cli -- theme apply local.my-theme
```

Une fois le paquet publié, ce sera `pnpm create @endue-ai/plugin my-theme --kind theme`. Le modèle
contient toutes les couleurs de rôle pour les deux schemes, toutes les autres couches à leur valeur par
défaut et un README qui dit ce que peint chacune ; `examples/plugin-hello-theme` est le plus petit thème
avec une police et un arrière-plan. Installer un thème ne l'applique pas : le réglage `desk.theme.active`
désigne celui qui est en vigueur, choisi dans le studio de thèmes (le bouton palette en haut à droite, ou
Themes dans la palette de commandes), avec `desk.theme.use` ou avec `desk theme apply`.

Le studio crée aussi des thèmes : « Tune a copy » (ou `desk.theme.edit`) ouvre son éditeur sur une copie du
thème sélectionné, « New theme » sur le thème endue. Chaque couche a ses contrôles, polices et images
d'arrière-plan comprises ; tout le bureau montre le brouillon à mesure qu'il change, les corrections du
contrôle sont listées sous la palette, et Save le garde comme votre propre thème (`local.<nom>`). Un dossier
est la façon de garder un thème dans un dépôt, de le tester et de le publier.

### Le bloc

`plugin.json` a le kind `theme` et un bloc `theme` (`specs/plugin/v0/theme.schema.json`), et ni
`entry`, ni `permissions`, ni `surfaces`, ni `contributes`, ni `autoload` :

```json
{
  "id": "example.dusk",
  "name": "Dusk",
  "version": "0.1.0",
  "kind": "theme",
  "theme": {
    "license": "Apache-2.0 AND OFL-1.1",
    "type": {
      "sans": "\"Space Grotesk\", system-ui, sans-serif",
      "fonts": [{ "family": "Space Grotesk", "src": "fonts/space-grotesk.woff2", "weight": "300 700" }]
    },
    "shape": { "radius": "round" },
    "dark": {
      "colors": { "background": "#1a1412", "text": "#f6ede6", "primary": "#ff9a62", "primaryForeground": "#2a1206" },
      "backdrop": { "gradient": ["#2e1c15", "#1a1412"], "glow": "rgba(255, 140, 80, 0.12)" }
    }
  }
}
```

`author`, `license` (une expression SPDX pour le thème et ses fichiers), `tags`, `preview` (jusqu'à cinq
couleurs pour sa carte dans la galerie) et `origin` (la phrase qui l'a décrit et le thème dont il est
parti) le décrivent. `light` et `dark` contiennent chacun un scheme. Un thème en demande un ; le thème
propre au bureau remplace l'autre.

### Couches et préréglages

Six couches, chacune avec une valeur par défaut, si bien qu'une palette seule fait un thème :

| Couche | Clé | Valeurs |
| --- | --- | --- |
| Palette | `<scheme>.colors` | Nom de jeton (camelCase) vers une couleur CSS : les rôles de `docs/design-system.md`, les jetons du shell et d'Eris. Un rôle omis garde celle du bureau |
| Matière | `<scheme>.material` | `opacity` 0,6–1, `blur` 0–24 px, `noise` 0–0,15, `border` 0–2 px, `shadow` none, soft ou strong |
| Typographie | `type` | piles de polices `sans` et `mono`, `scale` 0,85–1,25, `tracking` −0,02–0,05 em, `fonts` |
| Forme | `shape` | `radius` none, subtle, soft ou round ; `density` compact, comfortable ou spacious |
| Mouvement | `motion` | `personality` snappy, smooth ou calm |
| Arrière-plan | `<scheme>.backdrop` | Une `color`, un `gradient` de deux à quatre couleurs selon un `angle`, ou une `image` avec `fit` cover ou tile ; un `glow` |

`<scheme>.terminal.ansi` donne au terminal ses seize couleurs et `<scheme>.contrast` les changements de
la palette en contraste élevé. Arrondi, densité, mouvement, échelle du texte et ombre sont des
préréglages : le runtime traduit chaque nom en jetons (`docs/design-system.md`, « Choosing a theme »),
si bien qu'un thème continue de fonctionner quand le bureau les réajuste. Les nombres sont bornés et les
valeurs ne contiennent pas de `url()`, si bien que tout thème valide reste utilisable.

### Le contrôle de contraste

Le bureau fait passer chaque thème qu'il applique par un contrôle (`@endue-ai/ui/theme`) : le texte atteint
4,5:1 sur son fond, les bordures et remplissages 3:1, et en contraste élevé 7:1 et 4,5:1. Un premier plan
qui n'y arrive pas ne change que sa luminosité OKLCH, juste assez pour atteindre le rapport ; un fond ne
change jamais. Sans palette `contrast`, le contraste élevé d'un thème est dérivé de la même façon de ses
propres couleurs. Vérifiez vos paires dans les deux schemes, pour que le contrôle n'ait rien à corriger.

### Ressources et limites

Les polices sont des fichiers `.woff2` et les images des `.png`, `.jpg` ou `.webp` (pas de SVG, qui peut
contenir du script), dans le dossier : 2 Mio chacun et 8 Mio en tout. Indiquez la licence d'une police
dans `license` et gardez son fichier de licence à côté ; les thèmes intégrés gardent `fonts/OFL.txt` et un
`fonts/SOURCE.md` avec la source amont et les sommes de contrôle. Le bureau charge les polices d'un thème
en `FontFace` dans le shell et dans chaque cadre de plugin ; seul le shell dessine l'arrière-plan.

### Tester un thème

```bash
cargo run -p desk-cli -- plugin validate ../my-theme
cargo run -p desk-cli -- plugin test ../my-theme
```

`desk plugin validate` vérifie le bloc par rapport au schéma et les fichiers par rapport à leurs limites.
`desk plugin test` exécute le `tests/theme.test.ts` du modèle avec vitest sur l'hôte de test du SDK : il
compile les deux schemes avec `compileTheme` et les contrôle avec `gate` par-dessus la palette endue, comme
le bureau avant d'appliquer un thème, et échoue en listant chaque correction que le contrôle ferait.

### Partager en `.desk-theme`

```bash
cargo run -p desk-cli -- theme export local.my-theme     # local.my-theme.desk-theme in Downloads
cargo run -p desk-cli -- theme import ~/Downloads/dusk.desk-theme
```

Un `.desk-theme` est un seul fichier JSON : `format` `desk-theme/1`, le `plugin.json` du thème comme
`manifest`, et les fichiers que son bloc désigne dans `files`, en base64, 16 Mio au plus (ADR 0058).
L'importer le vérifie comme plugin de thème et l'installe dans le dossier de thèmes de la personne, où un id
hors de `local.` et `market.` devient `local.<son nom>` ; `desk theme list` l'affiche et `desk theme remove`
le supprime. Export et Import dans le studio font de même, et le studio accepte un `.desk-theme` déposé
dessus.

### Le marché

L'onglet Market du studio liste les thèmes des marchés que nomme le réglage `desk.theme.markets`, par
l'URL https de chaque index (ADR 0060). Par défaut, c'est le `market/themes/index.json` de ce dépôt sur
`main`, lu depuis `https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json`.
Ajoutez l'index d'un autre marché après lui dans `init.yaml` ; quand deux marchés listent le même id, le
premier l'emporte :

```yaml
settings:
  desk.theme.markets:
    - https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json
    - https://themes.example.com/index.json
```

Chaque carte montre les couleurs d'aperçu d'un thème, son nom, son auteur et sa licence, et où il en est
sur ce desk : Available, Installed, Update available ou Edited. Preview télécharge le `.desk-theme`,
vérifie son sha256 et l'affiche sur tout le desk sans l'installer. Install le fait entrer par
`theme.import` avec son URL et son sha256, sous son id dans `market.`, et Apply le met en vigueur. Une
mise à jour ne remplace un thème du marché que tant que vous ne l'avez pas modifié ; un thème que vous
avez modifié reste le vôtre.

Pour publier un thème, ouvrez une pull request qui ajoute son paquet et son entrée d'index dans
`market/themes/` :

1. Exportez le thème (`desk theme export <id> <file>`, ou Export dans le studio) avec un id dans
   `market.`, une version, `theme.author` et `theme.license` : une expression SPDX qui couvre aussi ses
   polices et ses images.
2. Placez le fichier dans `market/themes/` sous le nom `<name>.desk-theme` et ajoutez son entrée à
   `index.json` (`specs/plugin/v0/theme-index.schema.json`) : `id`, `name`, `version`, `description`,
   `author`, `license`, `tags`, jusqu'à cinq couleurs `preview`, `url` (le nom du fichier), `sha256` et
   `size`.
3. Lancez `node scripts/theme-market.mjs`. Le vérificateur du marché, inclus dans `just check`, refuse
   un hash ou une taille faux, une licence manquante, un id en double et un paquet qui n'est pas un
   plugin de thème valide ; un test passe chaque thème du marché au contrôle de contraste dans les deux
   schémas.

Une mise à jour est une nouvelle version, avec son nouveau paquet, son sha256 et sa taille.
`market/themes/README.md` reprend les mêmes étapes.
