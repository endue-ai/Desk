> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../plugins/authoring.md) maßgeblich.

# Ein Desk-Plugin schreiben

Ein Desk-Plugin ist ein Ordner. Eingebaute Funktionen nutzen genau dasselbe Format; alles, was Desk selbst auf
dem Bildschirm tut, kann also auch ein eigenes Plugin tun. Diese Seite beginnt mit den Arten von Plugins und
ihren Vorlagen, behandelt dann UI-Plugins im Detail und zuletzt Themes; Tool-Plugins (MCP) folgen später.

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
| `theme` | Die Werte des Designsystems mit den Schriften und Bildern, die sie nennen; ohne Code (Ein Theme erstellen, ADR 0056) | `examples/plugin-hello-theme` |

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

- `ui`, `view`, `policy`, `theme` und die übrigen Arten ohne Wasm: `tests/*.test.js` oder `*.test.ts` mit
  vitest auf dem Test-Host des SDK (`@endue-ai/plugin-sdk/testing`, siehe Testen unten), in einer
  jsdom-Seite. Das SDK wird über seinen Namen importiert; der getestete Code bleibt frei von diesem Import,
  wie in den Vorlagen (`ui/plugin.js`, dazu `ui/main.js`, das `defineUiPlugin(plugin)` aufruft).
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

Eine Oberfläche, die eine Weile niemand gesehen hat (hinter anderen Fenstern, außerhalb des Bildschirms),
kann entladen werden, um Speicher zu sparen, und lädt erneut, sobald sie sich zeigt (ADR 0070). Um so
zurückzukommen, wie sie war, registrieren Sie, was bleiben soll: `surface.onUnload(() => ({ open, caret,
scroll }))` beantwortet das `ui.surface.state` des Desks mit JSON bis 64 KiB, und die neu geladene Seite
findet es in `surface.restored`. Ohne Anbieter kommt sie kalt zurück; `state` oben kommt weiterhin zurück.

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

## Dateien bearbeiten: Bearbeitungsstufen

Ein Plugin, das Dateien öffnet, liest zuerst und bearbeitet später (ADR 0045). Sobald es bearbeitet, hat
jedes Format, das es öffnet, neben seiner Lesestufe eine Bearbeitungsstufe, eine von dreien (ADR 0071):

| Bearbeitungsstufe | Was sie verspricht | Beim Speichern |
| --- | --- | --- |
| `lossless` | Eine unveränderte Datei ergibt beim Speichern dieselben Bytes, und eine Änderung ändert nur die Bytes, die sie ändern muss | Überschreibt die Datei |
| `text` | Der Inhalt bleibt erhalten, die Formatierung vielleicht nicht (Kommentare, Leerraum, Reihenfolge der Schlüssel) | Das erste Speichern jeder Datei fragt: "Save as copy" (die Vorgabe) oder "Overwrite" |
| `read-only` | Es wird nichts gespeichert | Lehnt `desk.files.save` ab |

Nennen Sie die Stufe jedes Formats in Ihrer README (eine Tabelle der Formate mit Lese- und
Bearbeitungsstufe) und auf Ihrer Oberfläche vor der ersten Änderung, mit dem Element `desk-edit-tier` aus
`@endue-ai/ui`. Ein Format, für das Sie keine Stufe nennen, ist `read-only`, ebenso eine Datei, die nicht
in ihrer vollen Lesestufe öffnet. Versprechen Sie weniger, als Sie tun, nie mehr. Die Attribute `label`
und `detail` des Elements nehmen Ihre eigenen Worte auf.

```html
<desk-edit-tier tier="lossless" format="CSV"></desk-edit-tier>   <!-- CSV · Lossless editing -->
```

`lossless` ist ein Versprechen über Bytes, also belegen Sie es mit den zwei Prüfungen aus
`@endue-ai/plugin-sdk/testing`, über Fixtures, die die Eigenheiten Ihres Formats enthalten: ein BOM,
CRLF- und gemischte Zeilenenden, kein abschließender Zeilenumbruch, Anführungszeichen und Escapes.

```ts
import { assertMinimalEdit, assertRoundTrip } from "@endue-ai/plugin-sdk/testing";

const model = assertRoundTrip(bytes, parse, serialize); // serialize(parse(bytes)) must be bytes
setCell(model, "B2", "Busan");                           // B2 held "Seoul"
assertMinimalEdit(bytes, serialize(model), { find: "Seoul", bytes: "Busan" });
```

`parse` erhält ein `Uint8Array`; Zeichenketten gelten als UTF-8. Ein Bereich ist `{ offset, length }` in
Bytes der Datei oder `{ find }`, die einzige Stelle, an der diese Bytes vorkommen; `bytes` sagt, was daraus
werden muss, ohne es darf der Bereich zu allem werden. Ein Fehlschlag nennt das erste abweichende Byte mit
Zeile und Spalte, Hex und Text darum herum und die Änderungen außerhalb des Bereichs. Die Prüfungen
importieren nichts, daher kann ein einfacher Node-Test `packages/plugin-sdk/src/testing/round-trip.ts`
über seinen Pfad importieren.

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
cargo run -p desk-cli -- plugin test ../my-theme
```

`desk plugin validate` prüft den Block gegen das Schema und die Dateien gegen ihre Grenzen.
`desk plugin test` führt die `tests/theme.test.ts` der Vorlage mit vitest auf dem Test-Host des SDK aus:
Sie kompiliert beide Schemes mit `compileTheme` und prüft sie mit `gate` über der endue-Palette, wie der
Desk es vor dem Anwenden eines Themes tut, und schlägt mit jeder Korrektur fehl, die die Prüfung vornehmen
würde.

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

Der Market-Tab des Studios listet die Themes der Marktplätze, die die Einstellung `desk.theme.markets`
mit der https-URL ihres Index nennt (ADR 0060). Voreingestellt ist `market/themes/index.json` dieses
Repositorys auf `main`, gelesen von
`https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json`. Den Index eines anderen
Marktplatzes fügen Sie in `init.yaml` dahinter an; listen zwei Marktplätze dieselbe id, gilt der erste:

```yaml
settings:
  desk.theme.markets:
    - https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json
    - https://themes.example.com/index.json
```

Jede Karte zeigt die Vorschaufarben eines Themes, seinen Namen, Autor und seine Lizenz und wie es auf
diesem Desk steht: Available, Installed, Update available oder Edited. Preview lädt die `.desk-theme`
herunter, prüft ihre sha256 und zeigt sie auf dem ganzen Desk, ohne sie zu installieren. Install holt
sie über `theme.import` mit ihrer URL und sha256 herein, unter ihrer id in `market.`, und Apply setzt sie
in Kraft. Ein Update ersetzt ein Theme vom Marktplatz nur, solange Sie es nicht geändert haben; ein
Theme, das Sie geändert haben, bleibt Ihres.

Um ein Theme zu veröffentlichen, öffnen Sie einen Pull Request, der sein Bündel und seinen Indexeintrag
zu `market/themes/` hinzufügt:

1. Exportieren Sie das Theme (`desk theme export <id> <file>` oder Export im Studio) mit einer id in
   `market.`, einer Version, `theme.author` und `theme.license`: einem SPDX-Ausdruck, der auch seine
   Schriften und Bilder abdeckt.
2. Legen Sie die Datei als `<name>.desk-theme` in `market/themes/` und tragen Sie sie in `index.json`
   ein (`specs/plugin/v0/theme-index.schema.json`): `id`, `name`, `version`, `description`, `author`,
   `license`, `tags`, bis zu fünf `preview`-Farben, `url` (der Dateiname), `sha256` und `size`.
3. Führen Sie `node scripts/theme-market.mjs` aus. Die Marktplatzprüfung, Teil von `just check`, lehnt
   einen falschen Hash oder eine falsche Größe, eine fehlende Lizenz, eine doppelte id und ein Bündel ab,
   das kein gültiges Theme-Plugin ist; ein Test schickt jedes Theme des Marktplatzes in beiden Schemes
   durch die Kontrastprüfung.

Ein Update ist eine neue Version mit ihrem neuen Bündel, ihrer sha256 und Größe. `market/themes/README.md`
beschreibt dieselben Schritte.
