> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../plugins/authoring.md) maßgeblich.

# Ein Desk-Plugin schreiben

Ein Desk-Plugin ist ein Ordner. Eingebaute Funktionen nutzen genau dasselbe Format; alles, was Desk selbst auf
dem Bildschirm tut, kann also auch ein eigenes Plugin tun. Diese Seite behandelt UI-Plugins (v0) und
Themes; Logik-Plugins (Wasm) und Tool-Plugins (MCP) folgen später.

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

## Ein Theme erstellen

Ein Theme ist ein Plugin vom Kind `theme`: die Werte des Designsystems und die Schrift- und Bilddateien,
die sie nennen, ohne Code, und deshalb fragt es nach keiner Berechtigung (ADR 0056, ADR 0057). Beginnen
Sie mit der Vorlage oder dem Beispiel:

```bash
pnpm --filter @endue-ai/create-plugin build                       # once
node packages/create-plugin/dist/create-plugin.js ../my-theme --kind theme
DESK_DEV_PLUGINS=$PWD/../my-theme just dev
cargo run -p desk-cli -- theme apply local.my-theme
```

Sobald das Paket veröffentlicht ist, heißt das `pnpm create @endue-ai/plugin my-theme --kind theme`. Die
Vorlage hat jede Rollenfarbe für beide Schemes, jede andere Ebene auf ihrem Standardwert und eine README,
die sagt, was jeder Wert färbt; `examples/plugin-hello-theme` ist das kleinste Theme mit einer Schrift und
einem Hintergrund. Ein installiertes Theme ist noch nicht angewendet: Die Einstellung `desk.theme.active`
nennt das gültige, gewählt im Theme-Studio (die Paletten-Schaltfläche oben rechts oder Themes in der
Befehlspalette), mit `desk.theme.use` oder mit `desk theme apply`.

Auch das Studio erstellt Themes: „Tune a copy“ (oder `desk.theme.edit`) öffnet seinen Editor mit einer
Kopie des gewählten Themes, „New theme“ mit dem endue-Theme. Jede Ebene hat ihre Bedienelemente, Schriften
und Hintergrundbilder eingeschlossen; der ganze Desk zeigt den Entwurf, während er sich ändert, die
Korrekturen der Prüfung stehen unter der Palette, und Save behält ihn als Ihr eigenes Theme (`local.<name>`).
Ein Ordner ist der Weg, ein Theme in einem Repository zu halten, zu testen und zu veröffentlichen.

### Der Block

`plugin.json` hat das Kind `theme` und einen `theme`-Block (`specs/plugin/v0/theme.schema.json`) und
kein `entry`, keine `permissions`, `surfaces`, `contributes` und kein `autoload`:

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

`author`, `license` (ein SPDX-Ausdruck für das Theme und seine Dateien), `tags`, `preview` (bis zu fünf
Farben für seine Karte in der Galerie) und `origin` (der Satz, der es beschrieben hat, und das Theme, von
dem es ausging) beschreiben es. `light` und `dark` enthalten je ein Scheme. Ein Theme braucht eines davon;
für das andere springt das eigene Theme des Desks ein.

### Ebenen und Voreinstellungen

Sechs Ebenen, jede mit einem Standardwert, sodass schon eine Palette allein ein Theme ist:

| Ebene | Schlüssel | Werte |
| --- | --- | --- |
| Palette | `<scheme>.colors` | Token-Name (camelCase) auf eine CSS-Farbe: die Rollen aus `docs/design-system.md`, die Tokens der Shell und von Eris. Eine fehlende Rolle behält die des Desks |
| Material | `<scheme>.material` | `opacity` 0,6–1, `blur` 0–24 px, `noise` 0–0,15, `border` 0–2 px, `shadow` none, soft oder strong |
| Typografie | `type` | Schriftstapel `sans` und `mono`, `scale` 0,85–1,25, `tracking` −0,02–0,05 em, `fonts` |
| Form | `shape` | `radius` none, subtle, soft oder round; `density` compact, comfortable oder spacious |
| Bewegung | `motion` | `personality` snappy, smooth oder calm |
| Hintergrund | `<scheme>.backdrop` | Eine `color`, ein `gradient` aus zwei bis vier Farben in einem `angle` oder ein `image` mit `fit` cover oder tile; ein `glow` |

`<scheme>.terminal.ansi` gibt dem Terminal seine sechzehn Farben, `<scheme>.contrast` die Änderungen der
Palette bei hohem Kontrast. Rundung, Dichte, Bewegung, Textskala und Schatten sind Voreinstellungen: Die
Laufzeit macht aus jedem Namen Tokens (`docs/design-system.md`, „Choosing a theme“), sodass ein Theme
weiter funktioniert, wenn der Desk sie neu abstimmt. Zahlen sind begrenzt und Werte enthalten kein `url()`,
sodass jedes gültige Theme benutzbar bleibt.

### Die Kontrastprüfung

Der Desk prüft jedes Theme, das er anwendet (`@endue-ai/ui/theme`): Text erreicht 4,5:1 auf seinem
Grund, Rahmen und Flächen 3:1, bei hohem Kontrast 7:1 und 4,5:1. Ein Vordergrund, der das verfehlt,
ändert nur seine OKLCH-Helligkeit, gerade so weit, dass er das Verhältnis erreicht; ein Grund ändert sich
nie. Ohne `contrast`-Palette wird der hohe Kontrast eines Themes auf dieselbe Weise aus seinen eigenen
Farben abgeleitet. Prüfen Sie Ihre Paare in beiden Schemes, damit die Prüfung nichts zu korrigieren hat.

### Dateien und Grenzen

Schriften sind `.woff2`-Dateien, Bilder `.png`, `.jpg` oder `.webp` (kein SVG, das Skript enthalten
kann), im Ordner: je 2 MiB und zusammen 8 MiB. Nennen Sie die Lizenz einer Schrift in `license` und legen
Sie ihre Lizenzdatei daneben; die eingebauten Themes führen `fonts/OFL.txt` und eine `fonts/SOURCE.md` mit
Herkunft und Prüfsummen. Der Desk lädt die Schriften eines Themes als `FontFace` in der Shell und in jedem
Plugin-Frame; den Hintergrund zeichnet nur die Shell.

### Ein Theme testen

```bash
cargo run -p desk-cli -- plugin validate ../my-theme
pnpm exec vitest run --root ../my-theme
```

`desk plugin validate` prüft den Block gegen das Schema und die Dateien gegen ihre Grenzen. Die
`tests/theme.test.ts` der Vorlage kompiliert beide Schemes mit `compileTheme` und prüft sie mit `gate`
über der endue-Palette, wie der Desk es vor dem Anwenden eines Themes tut, und schlägt mit jeder
Korrektur fehl, die die Prüfung vornehmen würde.

### Als `.desk-theme` teilen

```bash
cargo run -p desk-cli -- theme export local.my-theme     # local.my-theme.desk-theme in Downloads
cargo run -p desk-cli -- theme import ~/Downloads/dusk.desk-theme
```

Eine `.desk-theme` ist eine einzige JSON-Datei: `format` `desk-theme/1`, die `plugin.json` des Themes als
`manifest` und die Dateien, die sein Block nennt, in `files`, base64, höchstens 16 MiB (ADR 0058). Beim
Import wird sie als Theme-Plugin geprüft und im Theme-Ordner der Person installiert, wo eine id außerhalb
von `local.` und `market.` zu `local.<ihr Name>` wird; `desk theme list` zeigt sie, `desk theme remove`
löscht sie. Export und Import im Studio tun dasselbe, und das Studio nimmt eine darauf gezogene
`.desk-theme` an.

### Der Marktplatz

Ein Theme-Marktplatz kommt (`docs/ko/theme-requirements.md`, TC-05 und TS-08): ein Index von
`.desk-theme`-Dateien mit ihrer sha256, die das Studio auflistet, in der Vorschau zeigt und unter ids in
`market.` installiert. `theme.import` nimmt schon eine `https`-URL mit der `sha256` des Bündels und lehnt
Bytes ab, die nicht passen. Bis der Marktplatz öffnet, teilen Sie die Datei selbst.
