> Ce document est une traduction. En cas de divergence, la [version anglaise](../../../plugins/authoring.md) fait foi.

# Écrire un plugin Desk

Un plugin Desk est un dossier. Les fonctionnalités intégrées utilisent exactement le même format : tout ce que
Desk fait lui-même à l'écran, votre plugin peut le faire aussi. Cette page traite des plugins UI (v0) ; les
plugins de logique (Wasm) et d'outils (MCP) viendront plus tard.

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

## Modifier des fichiers : niveaux d'édition

Un plugin qui ouvre des fichiers lit d'abord et modifie ensuite (ADR 0045). Dès qu'il modifie, chaque
format qu'il ouvre a un niveau d'édition à côté de son niveau de lecture, l'un de ces trois (ADR 0071) :

| Niveau d'édition | Ce qu'il promet | À l'enregistrement |
| --- | --- | --- |
| `lossless` | Enregistrer un fichier inchangé donne les mêmes octets, et une modification ne change que les octets qu'elle doit changer | Écrase le fichier |
| `text` | Le contenu est conservé ; la mise en forme peut ne pas l'être (commentaires, espaces, ordre des clés) | Le premier enregistrement de chaque fichier demande : "Save as copy" (par défaut) ou "Overwrite" |
| `read-only` | Rien n'est enregistré | Refuse `desk.files.save` |

Indiquez le niveau de chaque format dans votre README (un tableau des formats avec leurs niveaux de
lecture et d'édition) et sur votre surface avant la première modification, avec l'élément
`desk-edit-tier` de `@endue-ai/ui`. Un format pour lequel vous ne donnez aucun niveau est `read-only`,
de même qu'un fichier qui ne s'ouvre pas à son niveau de lecture complet. Promettez moins que ce que
vous faites, jamais plus. Les attributs `label` et `detail` de l'élément acceptent vos propres mots.

```html
<desk-edit-tier tier="lossless" format="CSV"></desk-edit-tier>   <!-- CSV · Lossless editing -->
```

`lossless` est une promesse sur des octets : prouvez-la avec les deux vérifications de
`@endue-ai/plugin-sdk/testing`, sur des fixtures qui contiennent les cas limites de votre format : un
BOM, des fins de ligne CRLF et mélangées, l'absence de saut de ligne final, des guillemets et des
échappements.

```ts
import { assertMinimalEdit, assertRoundTrip } from "@endue-ai/plugin-sdk/testing";

const model = assertRoundTrip(bytes, parse, serialize); // serialize(parse(bytes)) must be bytes
setCell(model, "B2", "Busan");                           // B2 held "Seoul"
assertMinimalEdit(bytes, serialize(model), { find: "Seoul", bytes: "Busan" });
```

`parse` reçoit un `Uint8Array` ; les chaînes sont lues en UTF-8. Une plage est `{ offset, length }` en
octets du fichier, ou `{ find }`, le seul endroit où ces octets apparaissent ; `bytes` dit ce qu'elle doit
devenir, et sans lui la plage peut devenir n'importe quoi. Un échec donne le premier octet différent avec
sa ligne et sa colonne, l'hexadécimal et le texte autour, et les changements hors de la plage. Les
vérifications n'importent rien, donc un test Node ordinaire peut importer
`packages/plugin-sdk/src/testing/round-trip.ts` par son chemin.

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
