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
`ui:notify`, `plugin:manage`) steht in `specs/plugin/v0/README.md`.

## Testen

`@endue-ai/plugin-sdk/testing` führt das Plugin ohne Browser gegen eine simulierte Bridge aus:

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event)
```

Vor der Veröffentlichung muss `desk plugin validate <folder>` erfolgreich durchlaufen; die CI führt den Befehl
für jeden Ordner in `plugins/` und `examples/` aus.
