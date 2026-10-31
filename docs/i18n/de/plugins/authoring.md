> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../plugins/authoring.md) maßgeblich.

# Ein Desk-Plugin schreiben

Ein Desk-Plugin ist ein Ordner. Eingebaute Funktionen nutzen genau dasselbe Format; alles, was Desk selbst auf
dem Bildschirm tut, kann also auch ein eigenes Plugin tun. Diese Seite behandelt UI-Plugins (v0);
Logik-Plugins (Wasm) und Tool-Plugins (MCP) folgen später.

## Mit dem Beispiel beginnen

```bash
cp -R examples/plugin-hello-ui ../my-plugin      # then change the id in plugin.json
cargo run -p desk-cli -- plugin validate ../my-plugin
```

Um ein Plugin schon während der Arbeit daran in Desk zu sehen, wird Desk mit dem eigenen Ordner als
Entwicklungs-Plugin gestartet:

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

Wird eine beliebige Datei im Ordner gespeichert, lädt innerhalb einer Sekunde nur die Oberfläche dieses Plugins
neu. Der Rest von Desk und der Zustand des Plugins bleiben, wie sie waren.

## Der Ordner

| Pfad | Erforderlich | Zweck |
| --- | --- | --- |
| `plugin.json` | ja | Das Manifest: id, version, kind, entry, permissions, surfaces |
| `ui/index.html` | ja (der `entry`) | Die Seite, die Desk in einen Sandbox-Frame lädt |
| `ui/*.js`, `ui/*.css` | nein | Eigener Code und Styles, relativ zum Einstiegspunkt geladen |
| `README.md` | empfohlen | Was das Plugin tut, welche Berechtigungen es anfordert und warum |

Das Manifest folgt `specs/plugin/v0/plugin.schema.json`:

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

IDs sind kleingeschrieben und folgen der Reverse-Domain-Notation (`example.my-plugin`). Der Einstiegspunkt
bleibt innerhalb des Ordners.

## Das SDK

Das SDK wird über eine Import-Map in der Einstiegsseite importiert; Desk stellt es unter
`/_desk/plugin-sdk.js` bereit:

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

`bridge.call(method, params)` erreicht den Kern. Aufrufe im selben Tick werden gemeinsam in einer Nachricht
übertragen. Ein abgelehnter Aufruf wird mit einem `BridgeCallError` zurückgewiesen, dessen `code`
beispielsweise `permission_denied` ist.

## Berechtigungen

Der Frame des Plugins läuft in einer Sandbox, die nur Skripte erlaubt: kein Zugriff auf die Seite von Desk,
keine Top-Level-Navigation, keine Formulare oder Pop-ups und keine eigenen Netzwerkverbindungen. Jede
Fähigkeit läuft über die Bridge, und jeder Bridge-Aufruf außer `perm.*` trägt den Berechtigungsbereich, den er
benötigt (`params.scope`). Der Kern antwortet nur, wenn die nutzende Person eine Berechtigung erteilt hat, die
diesen Bereich abdeckt.

1. Alles, was angefordert werden könnte, in `permissions` von `plugin.json` deklarieren.
2. Erst in dem Moment anfragen, in dem es gebraucht wird: `bridge.call("perm.request", { permission, reason })`.
3. Bei jedem Aufruf den passenden Bereich mitgeben, so eng wie möglich.

Das Vokabular (`fs:read`, `fs:write`, `proc:spawn`, `net:fetch`, `audio:capture`, `ui:surface`,
`ui:notify`, `plugin:manage`, `brain:converse`, `cmd:invoke`, `cmd:advise`, `settings:read`, `log:read`,
`events:subscribe`, `perm:manage`, `data:read`, `connector:manage`, `view:manage`) steht in `specs/plugin/v0/README.md`.

## Beiträge

Ein Plugin kann die Standardrichtlinien des Desks ohne Code ergänzen, in `contributes` von `plugin.json`
(ADR 0017): Befehle, die die Palette auflistet und Tasten ausführen, Tastenbelegungen, Anzeigeregeln,
die Dateien, die es öffnet, Themes, Einstellungen mit ihren Standardwerten und Profile. Befehle,
Einstellungen und Themes beginnen mit der Plugin-ID.

```json
"contributes": {
  "commands": [{ "id": "example.my-plugin.new", "title": "New note" }],
  "keys": [{ "key": "Mod+Shift+N", "command": "example.my-plugin.new" }],
  "display": [{ "match": { "plugin": "example.my-plugin" }, "area": "right", "size": { "pixels": 360 } }],
  "files": [{ "pattern": "*.md", "plugin": "example.my-plugin" }],
  "settings": { "example.my-plugin.folder": { "kind": "string", "default": "~/notes" } }
}
```

Beantworten Sie Ihre Befehle mit `ctx.commands.on`, und führen Sie jeden Befehl des Desks mit
`ctx.commands.run` aus. Beides läuft über das Befehlsregister des Kerns (`cmd.*`); einen Befehl, den Sie
nicht selbst anbieten, auszuführen, braucht eine `cmd:invoke`-Berechtigung, die seine ID abdeckt, etwa
`{ "permission": "cmd:invoke", "ids": ["desk.theme.*"] }`:

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

Ein Plugin, das Dateien öffnet, beantwortet `desk.files.visit`, `desk.files.save` und
`desk.files.revert` und meldet ungespeicherte Änderungen mit `desk.buffers.update { id, modified: true }`.
Das Theme erreicht Ihren Frame als CSS-Eigenschaften `--desk-*` und als `ctx.theme`. Tastenkombinationen,
die in Ihrem Frame gedrückt werden, erreichen die Tastenbelegung des Desks, außer Sie rufen
`preventDefault()` auf. Die Standardrichtlinien und was jede entscheidet, stehen in `plugins/README.md`.

## Einträge und Ansichten

Was die Apps enthalten, die eine Person verbindet, kommt als Einträge einer einzigen Form auf den
Desk (`specs/item/v0`, ADR 0032): Termine, Aufgaben, Nachrichten, Notizen und mehr, aus jeder Quelle
gleich. `ctx.data` liest den Index des Desks mit einer `data:read`-Berechtigung und übergibt den
engsten Geltungsbereich, den eine Abfrage braucht; `ctx.views` liest und speichert die Ansichten der
Person mit `view:manage`:

```js
const { items } = await ctx.data.query({
  kinds: ["task"],
  where: [{ field: "due", op: "lt", value: "2026-10-31T00:00:00+09:00" }],
});
const stop = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => redraw(changes));
await ctx.commands.run("desk.views.open", { id: "desk.today" });
```

Eine Ansicht ist Daten, kein Code (`specs/view/v0`): das eingebaute `desk.views` zeichnet sie mit den
Elementen von `@endue-ai/ui` (`desk-list`, `desk-table`, `desk-agenda`, `desk-stat`, `desk-markdown`,
`desk-card`), und ihre Vorlagen kennen die Uhr (`{today}`, `{tomorrow}`). Ihre Seite kann dieselben
Elemente importieren (`"@endue-ai/ui": "/_desk/ui.js"` in ihrer Import-Map), sobald die App sie
ausliefert; der Testserver der Laufzeit tut es schon.

## Testen

`@endue-ai/plugin-sdk/testing` führt das Plugin ohne Browser gegen eine simulierte Bridge aus:

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event), host.upsert(item)
```

Vor der Veröffentlichung muss `desk plugin validate <folder>` erfolgreich durchlaufen; die CI führt den Befehl
für jeden Ordner in `plugins/` und `examples/` aus.
