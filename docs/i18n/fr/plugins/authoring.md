> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../plugins/authoring.md) fait foi.

# Écrire un plugin Desk

Un plugin Desk est un dossier. Les fonctionnalités intégrées utilisent exactement le même format : tout ce que
Desk fait lui-même à l'écran, votre plugin peut le faire aussi. Cette page traite des plugins UI (v0) et des
thèmes ; les plugins de logique (Wasm) et d'outils (MCP) viendront plus tard.

## Partir de l'exemple

```bash
cp -R examples/plugin-hello-ui ../my-plugin      # then change the id in plugin.json
cargo run -p desk-cli -- plugin validate ../my-plugin
```

Pour voir un plugin dans Desk pendant que vous travaillez dessus, lancez Desk avec votre dossier comme plugin
de développement :

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

Enregistrez n'importe quel fichier du dossier : seule la surface de votre plugin se recharge, en moins d'une
seconde. Le reste de Desk, ainsi que l'état de votre plugin, restent tels quels.

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
pnpm exec vitest run --root ../my-theme
```

`desk plugin validate` vérifie le bloc par rapport au schéma et les fichiers par rapport à leurs limites.
Le `tests/theme.test.ts` du modèle compile les deux schemes avec `compileTheme` et les contrôle avec
`gate` par-dessus la palette endue, comme le bureau avant d'appliquer un thème, et échoue en listant chaque
correction que le contrôle ferait.

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

Un marché de thèmes arrive (`docs/ko/theme-requirements.md`, TC-05 et TS-08) : un index de fichiers
`.desk-theme` avec leur sha256, que le studio liste, prévisualise et installe sous des id dans `market.`.
`theme.import` accepte déjà une URL `https` avec le `sha256` du paquet et refuse des octets qui ne
correspondent pas. En attendant l'ouverture du marché, partagez le fichier lui-même.
