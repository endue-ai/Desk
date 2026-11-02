> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../plugins/authoring.md) maßgeblich.

# Ein Desk-Plugin schreiben

Ein Desk-Plugin ist ein Ordner. Eingebaute Funktionen nutzen genau dasselbe Format; alles, was Desk selbst auf
dem Bildschirm tut, kann also auch ein eigenes Plugin tun. Diese Seite beginnt mit den Arten von Plugins und
ihren Vorlagen und behandelt dann UI-Plugins im Detail; Tool-Plugins (MCP) folgen später.

## Mit einer Vorlage beginnen

`create-plugin` legt einen Ordner einer Art an, der `desk plugin validate` besteht und einen Test mitbringt
(`pnpm create @endue-ai/plugin`, sobald das Paket veröffentlicht ist):

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --kind ui
cargo run -p desk-cli -- plugin validate ../my-plugin
cargo run -p desk-cli -- plugin test ../my-plugin
```

| Art | Was es ist | Beispiel |
| --- | --- | --- |
| `ui` | Eine Seite in einem isolierten Frame, auf dem SDK (der Rest dieser Seite) | `examples/plugin-hello-ui` |
| `logic` | Eine Wasm-Komponente der Welt `desk:host`, in Rust (ADR 0019) | `examples/plugin-hello-wasm` |
| `connector` | Eine Wasm-Komponente der Welt `desk:connector`, die Einträge hereinholt (ADR 0034) | `examples/plugin-hello-connector` |
| `view` | Eine Ansicht als Daten: was sie zeigt, aus welchen Quellen; ohne Code (ADR 0032) | `examples/plugin-hello-view` |
| `policy` | Befehle, Tasten und die übrigen Beiträge als Daten; ohne Code (ADR 0017) | die `desk.*`-Richtlinien in `plugins/` |

Die Rust-Arten werden mit dem eigenen Befehl der Sprache gebaut: `cargo build --release` im Ordner, für das
Ziel `wasm32-wasip2` (einmalig `rustup target add wasm32-wasip2`). Die Komponente landet dort, wohin `entry` in
`plugin.json` zeigt.

Um ein Plugin schon während der Arbeit daran in Desk zu sehen, wird Desk mit dem eigenen Ordner als
Entwicklungs-Plugin gestartet:

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

Wird eine beliebige Datei im Ordner gespeichert, lädt innerhalb einer Sekunde nur dieses Plugin neu. Der Rest
von Desk und der Zustand des Plugins bleiben, wie sie waren. Ein Ordner, der beim Start von Desk leer oder
fehlerhaft ist, erscheint, sobald seine Dateien da oder behoben sind, ohne Neustart.

### Testen mit `desk plugin test`

`desk plugin test <folder>` prüft den Ordner wie `validate` und führt dann seine `tests/` auf dem Host aus, der
zu seiner Art passt:

- `ui`, `view`, `policy` und die übrigen Arten ohne Wasm: `tests/*.test.js` oder `*.test.ts` mit vitest auf
  dem Test-Host des SDK (`@endue-ai/plugin-sdk/testing`, siehe Testen unten), in einer jsdom-Seite. Das SDK
  wird über seinen Namen importiert; der getestete Code bleibt frei von diesem Import, wie in den Vorlagen
  (`ui/plugin.js`, dazu `ui/main.js`, das `defineUiPlugin(plugin)` aufruft).
- `logic` und Wasm-`connector`: jede `tests/<name>.test.json` auf einem geskripteten Desk, dem Harness von
  `desk-plugin-host`, mit der gebauten Komponente:

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

`steps` ist, was der Desk tut: `start`, `command` (`id`, `args`) und `event` (`name`, `data`) für ein
Logik-Plugin, `connect` (`instance`, `settings`) und `sync` (`instance`) für einen Connector. Jeder Import, den
das Plugin aufruft, wird als Bridge-Aufruf `{ method, params }` aufgezeichnet (`fs.read { path }`,
`cmd.answer { invocationId, result }`) und vom ersten Eintrag in `answers` beantwortet, dessen `method` passt
und dessen `params` der Aufruf enthält: mit `result` oder mit `error`
(`{ "code": "not_found", "message": "…" }`). Ein Aufruf, den nichts beantwortet, erhält die leere Antwort:
nichts, `null`, `[]` oder eine neue id; `store.get` liefert, was das Plugin gespeichert hat; Dateien und
Netzwerk antworten mit `not_found` und `unsupported`. Die Aufrufe in `expect.calls` müssen in dieser
Reihenfolge erfolgt sein, und die `expect.items` eines Connectors müssen unter den Einträgen sein, die seine
Synchronisierungen gebracht haben; jeder passt, wenn er enthält, was dort steht. Ein Fehlschlag nennt, was
erwartet wurde, und listet, was stattdessen kam.

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
