> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../architecture.md) maßgeblich.

# Architektur von endue Desk

Dieses Dokument übersetzt die englische Zusammenfassung des Designs. Maßgebliche Quelle ist
`docs/ko/desk-structure.md`; schwer umkehrbare Entscheidungen stehen in `docs/adr/`.

Desk ist ein OS, gebaut als eine App: Eine Tauri-Shell und ein kleiner Rust-Kern tragen eine Web-Runtime,
und jede Funktion auf dieser Runtime ist ein Plugin. Wie bei Emacs enthält der Kern nur Primitive, und
alles andere lässt sich im laufenden Betrieb ändern.

## Auf einen Blick

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge → TS client · Rust traits            │  rebuild
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · plugin host   │  rebuild
 │              · VM · brain clients                              │
 ├────────────────────────────────────────────────────────────────┤
 │ Tauri shell  windows · webviews · primitives (fs, proc, net,   │  rebuild
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
| Web-Runtime | `packages/runtime` · `packages/ui` |
| Desk-Bridge | `specs/bridge` · `packages/bridge` · `crates/desk-bridge` |
| Rust-Kern | `crates/desk-core` · `crates/desk-plugin-host` · `crates/desk-vm` · `crates/desk-brain*` |
| Tauri-Shell | `apps/desk/src-tauri` · `crates/desk-sys` |
| OS | `apps/desk/src-tauri/capabilities` · Release-Workflow (Signierung, Notarisierung) |

## Wie Emacs, wie ein OS

Emacs führt fast alles in Elisp auf einem kleinen C-Kern aus und lässt sich im laufenden Betrieb ändern.
Desk übernimmt diese Form und benennt die Teile so, wie es ein Betriebssystem tun würde.

| Rolle | Betriebssystem | Emacs | Desk |
| --- | --- | --- | --- |
| Kernel | Kernel | C-Kern | Rust-Kern |
| Systemaufrufe | Syscalls | Lisp-Primitive | Desk-Bridge-API |
| Treiber | Gerätetreiber | OS-Anbindung | Tauri-Shell + Rust-Crates |
| Fenstermanager | Fenstermanager | Frames · Windows | 3D-Canvas-Compositor |
| Shell | Terminal-Shell | M-x | Eris · Befehlspalette |
| Apps | Anwendungen | Pakete (Elisp) | Plugins (UI · Wasm · MCP) |
| Boot-Konfiguration | init | init.el | `init.yaml` (Profil + Plugins + Einstellungen) |
| Paketmanager | apt · brew | package.el · MELPA | Marktplatz |
| Verhalten überschreiben | keine | Advice · Hooks | Event-Hooks · Befehls-Overrides |
| Konten | Benutzerkonten | keine | endue ID |

Daraus folgen sechs Prinzipien:

1. **Kleiner Kern.** Der Rust-Kern enthält Primitive (fs, proc, net, audio, ui), keine Funktionen.
2. **Eingebaute Funktionen sind Plugins.** Eris, die Seitenleiste, die Werkzeugleiste und der
   Profilwechsel nutzen dieselbe API wie Community-Plugins. So hat die API keine Lücken, und selbst
   eingebaute Funktionen lassen sich ersetzen. Auch die Standardrichtlinien des Desks (wo Oberflächen
   erscheinen, Tasten, Dateien, Themes, Benachrichtigungen) sind reine Daten-Plugins `desk.*` (ADR 0017).
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
 │  Rust core · Tauri shell · bridge types   restart after update │
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
