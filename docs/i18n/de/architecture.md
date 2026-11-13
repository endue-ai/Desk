> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../architecture.md) maßgeblich.

# Architektur von endue Desk

Dieses Dokument übersetzt die englische Zusammenfassung des Designs. Maßgebliche Quelle ist
`docs/ko/desk-structure.md`; schwer umkehrbare Entscheidungen stehen in `docs/adr/`.

Desk ist ein OS, gebaut als eine App: Eine Rust-Shell auf Chromium (CEF) und ein kleiner Rust-Kern tragen eine Web-Runtime,
und die Funktionen außer Einstellungen und Tastenkürzeln sind Plugins. Wie bei Emacs enthält der Kern nur Primitive, und
alles andere lässt sich im laufenden Betrieb ändern.

Die Einstellungsoberfläche, Standardtastenkürzel und das Speichern persönlicher Einstellungen gehören zum Runtime-Kern, nicht zu Plugins. Sie bleiben ohne Plugins verfügbar; Plugins können weitere Tastenkürzel beitragen. [ADR 0055](../../adr/0055-core-settings-and-keybindings.md).

Shell und Bildschirm ändern sich: Desk ist von Tauri und den Webviews des OS zu einer Rust-Shell auf
Chromium (CEF) gewechselt und geht weiter zu einem eigenen Compositor, in dem jedes Fenster in seinem eigenen
Prozess rendert ([ADR 0140](../../adr/0140-a-wgpu-compositor-over-cef-off-screen-surfaces.md)). Stufe 1
endete mit dem Löschen der Tauri-Shell; die unten beschriebene Shell ist die CEF-Shell. „Wohin Shell und Bildschirm gehen“
unter der Tabelle der Schichten nennt die Stufen.

## Auf einen Blick

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 │              · connectors (Wasm · MCP · http) · views (data)   │
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 │              · UI plugin host · desk shell (until ADR 0026)    │
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge · specs/item · specs/view            │  rebuild
 │              · specs/connector → TS client · Rust types        │
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · item index    │  rebuild
 │              · logic plugin and connector host (Wasm) · VM     │
 │              · built-in connectors · brain clients             │
 ├────────────────────────────────────────────────────────────────┤
 │ Shell (CEF)  windows · browsers · primitives (fs, proc, net,   │  rebuild
 │              audio)                                            │
 ├────────────────────────────────────────────────────────────────┤
 │ OS           macOS · Windows · Linux (signing, notarisation,   │  —
 │              OS permissions)                                   │
 └────────────────────────────────────────────────────────────────┘
```

Höhere Schichten ändern sich, während die App läuft; untere Schichten erfordern ein App-Update. Nur
endue AI liegt außerhalb des Geräts. Alles andere läuft auf dem Computer des Nutzers.

| Schicht | Ordner |
| --- | --- |
| endue AI (Cloud) | außerhalb des Repositorys; hier liegen nur `specs/brain` und `crates/desk-brain-endue` |
| Plugins | `plugins/` · `packages/plugin-sdk` · `specs/plugin` · `specs/wit` · `examples/` |
| Web-Runtime | `packages/runtime`: die Systemoberfläche des Desks (ADR 0160): der Host für UI-Plugins (ADR 0012), die Richtlinien und, bis ADR 0026 entschieden ist, die Teile der Desk-Shell (ADR 0025); in der App ordnet sie kein Fenster an und hält keinen Plugin-Frame · `packages/ui` |
| Desk-Bridge | `specs/bridge` · `specs/item`, `specs/view` und `specs/connector`, die Verträge der Integrationsschicht (ADR 0032) · `packages/bridge` · `crates/desk-bridge` (aus diesen Verträgen und `specs/plugin` generierte Typen) |
| Rust-Kern | `crates/desk-core`, der auch die Integrationsschicht bereitstellt (`data.*`, `connector.*`, `view.*`, `catalog.get`) und die eingebauten Konnektoren `desk.calendar` und `desk.reminders` auf Basis des OS-Kalenders definiert (ADR 0036, vorgeschlagen) und http-Konnektoren nach ihrem Manifest selbst ausführt, wobei nur er ihre Tokens liest (ADR 0106) · `crates/desk-index`, der Index der Einträge in einer einzigen SQLite-Datei (ADR 0033) · `crates/desk-plugin-host`, der Logik-Plugins (ADR 0019) und Wasm-Konnektoren (ADR 0034, vorgeschlagen) auf Wasmtime ausführt · `crates/desk-vm` · `crates/desk-brain*` |
| Shell (CEF) | `apps/desk/shell`, die App `endue-desk` auf winit und CEF (ADR 0143), und `crates/desk-web`, was ihre URL-Schemata antworten und welcher Aufrufer jede Seite ist, ohne die Engine · `crates/desk-sys` · `crates/desk-computer`, Computer Use unter macOS (Bildschirmfotos, der Bedienungshilfen-Baum, Eingaben, Apps), den der Kern als `computer.*` unter `computer:see` und `computer:control` anbietet; jede Handlung eines Agenten wartet auf die Zustimmung der Person (ADR 0120, ADR 0123) |
| OS | `apps/desk/shell/packager`: die Pakete, die Hilfs-Apps von CEF und ihre Entitlements (ADR 0145) · Release-Workflow (Signierung, Notarisierung) |

## Wohin Shell und Bildschirm gehen

Bis Stufe 1 war Desk ein Tauri-Fenster mit einer einzigen Webview des OS, und jedes Plugin-Fenster ein
iframe in einer Sandbox auf dieser einen Seite. Shell und alle Plugins teilten sich einen Prozess und einen
Hauptthread: Ein Plugin in einer Endlosschleife hielt den ganzen Desk an, und unter Linux fehlte WebGPU.
ADR 0140 ändert das: Jedes Fenster rendert in seinem eigenen Prozess, und ein eigener Compositor von Desk
auf wgpu platziert, was sie rendern. Seit Stufe 1 ist jede Plugin-Oberfläche ein eigener Chromium-Renderer,
ein abgestürzter Renderer kostet also nur sein Fenster. Seit #83 ist der Compositor der einzige Desk
(ADR 0156): Jede Plugin-Oberfläche rendert off-screen in einem eigenen Browser, der Compositor zeichnet sie
dort, wo `crates/desk-wm` ihr Fenster platziert, und desk-wm führt die Fenstergesten, die Fensterbefehle
und das Live-Budget. Was Web bleibt, läuft als Systemoberflächen, die der Compositor über jedes Fenster
legt (ADR 0160): die eigene Seite des Desks (die Leisten, Eris, Mitteilungen, Menüs, Einstellungen und
die Studios, jeder Teil ganz gezeichnet), das Fenster der Palette und das der Insel, jede ruft als ihr
Fenster auf. Kein Plugin läuft in der Seite des Desks: Ihr Plugin-Host erreicht den eigenen Browser jedes
Plugins über die Shell. Die Insel (ADR 0204) ist die eine Oberfläche über anderen Apps, solange der Desk
nicht vorne ist: die arbeitenden Agenten, was auf eine Antwort wartet, und die Mitteilungen, einen Druck
entfernt von der Antwort auf eine Berechtigungsanfrage oder die Freigabe eines Agenten und vom Gespräch
mit Eris, die Option+Enter aus jeder App ruft. Sie hat den Platz der schwebenden Eris (ADR 0121)
eingenommen.

```text
 desk (Rust, one process): winit · compositor (wgpu) · CEF host · core · updater
        │ surface             │ surface             │ surface              │ no surface
 web plugin             web plugin            native plugin          logic plugin
 (CEF renderer)         (WebGPU, 3D)          (its own process)      (Wasm, unchanged)
 each: its own process · its own main thread · its own GPU queue · a crash empties one window
```

| Stufe | Was sich ändert | Stand |
| --- | --- | --- |
| 0 | Auf der Tauri-App: Jede Oberfläche bekommt einen eigenen Origin auf dem Schema `desk-plugin`; nur die sichtbaren Fenster und die 8 zuletzt fokussierten behalten einen lebenden Frame; schwere Arbeit wandert in Worker; ein Frame, der nicht mehr antwortet, bietet nur in seinem Fenster „Warten“ oder „Beenden“ an | erledigt |
| 1 | Die Shell wird ein Rust-Binary auf winit und CEF (`apps/desk/shell`, ADR 0143), das die heutige Shell-Seite zeigt, und Tauri fällt weg; jedes Plugin-iframe ist ein eigener Chromium-Renderer; die App-E2E-Tests steuern es über das Remote-Debugging von Chromium (ADR 0144) | erledigt (#97): der CEF-Desk hat die Tauri-App unter ihrem Namen `endue-desk` ersetzt, und Canary baut ihn; WebGPU unter Windows und Linux wird auf diesen OS geprüft (#61), und die erste Beta, die sich über den Updater installiert, kommt mit der nächsten Release-Linie |
| 2 | Der Compositor (`crates/desk-compositor`) zeichnet den Desk und platziert die Textur jeder Oberfläche; Oberflächen sprechen ein Protokoll (`specs/surface`, ADR 0141); CEF rendert jedes Plugin off-screen; der Fenstermanager wandert von `packages/runtime` nach Rust | in Arbeit: Der Compositor ist der einzige Desk, und desk-wm platziert jedes Fenster und führt seine Gesten, Befehle und das Live-Budget (#83); was Web bleibt, läuft als Systemoberflächen, ohne Plugin in der Seite des Desks (#55); als Nächstes kommt das Aussehen der Ausbreitung |
| 3 | Native Plugins: ein Prozess, der das Oberflächenprotokoll und die Bridge über `desk.sock` spricht | geplant |

Am Code der Plugins ändert sich in keiner Stufe etwas: Manifest, SDK und das Wire-Format der Bridge bleiben.
Ein Plugin gewinnt einen eigenen Prozess und Origin sowie WebGPU auf jedem OS. Nur die sichtbaren Fenster
und die 8 zuletzt fokussierten behalten einen lebenden Prozess; die übrigen schlafen mit ihrem Zustand
(ADR 0142). Ein Proof of Concept auf macOS hat 30 Off-screen-Oberflächen von CEF mit wgpu zusammengesetzt,
WebGPU darin ausgeführt, und die übrigen zeichneten weiter, während ein Renderer beendet wurde; ein leichter
Renderer kostete etwa 40 MiB (`spikes/compositor/README.md`). Windows und Linux stehen noch aus.

## Wie Emacs, wie ein OS

Emacs führt fast alles in Elisp auf einem kleinen C-Kern aus und lässt sich im laufenden Betrieb ändern.
Desk übernimmt diese Form und benennt die Teile so, wie es ein Betriebssystem tun würde.

| Rolle | Betriebssystem | Emacs | Desk |
| --- | --- | --- | --- |
| Kernel | Kernel | C-Kern | Rust-Kern |
| Systemaufrufe | Syscalls | Lisp-Primitive | Desk-Bridge-API |
| Treiber | Gerätetreiber | OS-Anbindung | die Shell (winit, CEF) + Rust-Crates |
| Fenstermanager | Fenstermanager | Frames · Windows | 3D-Canvas-Compositor |
| Shell | Terminal-Shell | M-x | Eris · Befehlspalette |
| Apps | Anwendungen | Pakete (Elisp) | Plugins (UI · Wasm · MCP) |
| Verbundene Daten | eingehängte Dateisysteme · Suchindex | Gnus-Backends · Org-Agenda | Konnektoren · Einträge in einem gemeinsamen Index · Ansichten (ADR 0032) · universelle Ansichten über jede Quelle eines YAML-Formats (ADR 0087) |
| Boot-Konfiguration | init | init.el | `init.yaml` (Profil + Plugins + Einstellungen) |
| Paketmanager | apt · brew | package.el · MELPA | Marktplatz |
| Verhalten überschreiben | keine | Advice · Hooks | Event-Hooks · Befehls-Overrides |
| Konten | Benutzerkonten | keine | endue ID |

Daraus folgen sechs Prinzipien:

1. **Kleiner Kern.** Der Rust-Kern enthält Primitive (fs, proc, net, audio, ui), keine Funktionen.
2. **Eingebaute Funktionen sind Plugins.** Eris, die Seitenleiste, die Werkzeugleiste und der
   Profilwechsel nutzen dieselbe API wie Community-Plugins. So hat die API keine Lücken, und selbst
   eingebaute Funktionen lassen sich ersetzen. Auch die Standardrichtlinien des Desks (wo Oberflächen
   erscheinen, Dateien, Themes, Benachrichtigungen) sind reine Daten-Plugins `desk.*` (ADR 0017).
   Die Desk-Shell (`mountDesk`) ist es noch nicht: Sie ist Code in `packages/runtime` (ADR 0025), bis die
   noch vorgeschlagene ADR 0026 entscheidet, wohin sie gehört. Bis dahin gibt es Eris zweimal, als
   `plugins/eris` und in der Shell (ADR 0027), und ebenso die Ränder des Desks: die Plugins Dock,
   Werkzeugleiste und Seitenleiste auf der einen Seite, den unteren Rand, die Statusleiste und die
   Agentenleiste der Shell auf der anderen (ADR 0028).
3. **Alles ist ein Befehl.** Klicks, Sprache, Tastenkürzel und Agenten rufen dieselben Befehle auf. Was
   ein Mensch tun kann, können auch Eris und Agenten.
4. **Ändern im laufenden Betrieb.** Das Speichern eines Plugins lädt es neu; der Plugin-Zustand liegt im
   Speicher des Kerns und übersteht den Austausch.
5. **Überall einhaken.** Jeder Befehl kann Hooks davor und danach erhalten oder vollständig ersetzt
   werden, wie bei Emacs-Advice.
6. **Erst fragen, dann schauen.** Jeder Aufruf eines Primitivs, ob von einem Menschen oder einem Agenten,
   durchläuft die Berechtigungsprüfung der Bridge.

## Was sich ändert, und wie schnell

```text
 ┌─ rebuild ──────────────────────────────────────────────────────┐
 │  Rust core · Shell (CEF) · bridge types   restart after update │
 │  ┌─ restart ────────────────────────────────────────────────┐  │
 │  │  web runtime                         window reload, ~2 s │  │
 │  │  ┌─ instant ──────────────────────────────────────────┐  │  │
 │  │  │  one plugin (iframe · Wasm · MCP)           < 1 s  │  │  │
 │  │  └────────────────────────────────────────────────────┘  │  │
 │  └──────────────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────────────┘
```

Je weiter innen, desto günstiger die Änderung. Für Nutzer ist ein Rebuild ein Neustart nach einem
automatischen Update; für Entwickler bedeutet er zusätzlich Kompilieren, Signieren und Notarisieren.

| Stufe | Was neu lädt | Ziel | Was weiterläuft |
| --- | --- | --- | --- |
| Sofort | das geänderte Plugin (iframe, Wasm-Instanz oder MCP-Prozess) | unter 1 s | andere Oberflächen, laufende Arbeit, Sprach-Standby |
| Neustart | die Web-Runtime (Neuladen des Fensters) | etwa 2 s | der Rust-Kern, MCP-Tools, laufende CLIs |
| Rebuild | die ganze App (Neustart nach einem automatischen Update) | Downloadzeit + einige Sekunden | gespeicherter Zustand, Profile, installierte Plugins |

Die Entwicklung nutzt dieselben drei Stufen: Plugin-Ordner laden beim Speichern neu, die Web-Runtime
nutzt Vite HMR, und der Rust-Kern wird mit `cargo watch` neu gebaut.

## Verträge

`specs/` zieht die Grenze zwischen offen und geschlossen. Die Bridge-, Brain- und Plugin-Typen werden
daraus für Rust und TypeScript generiert, und beide Seiten testen gegen dieselben Vektoren. Siehe
`specs/README.md`.
