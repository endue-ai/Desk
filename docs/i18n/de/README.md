> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../README.md) maßgeblich.

# endue Desk

Eine App, die ein OS ist.

**Keine festen Bildschirme.** Desk ist eine Tauri-Shell und ein kleiner Rust-Kern mit einer Web-Runtime
darüber, und jede Funktion oberhalb davon, die eingebauten eingeschlossen, ist ein Plugin, das sich im
laufenden Betrieb ersetzen lässt. Wie bei Emacs: Der Kern enthält nur Primitive (Dateien, Prozesse,
Netzwerk, Audio, Fenster), und alles andere ist Code, der sich ohne Neustart ändern lässt.

> Status: Pre-Alpha. `just dev` öffnet die Arbeitsfläche mit Eris und dem ersten Start; starten Sie vorher `just brain-echo`, dann antwortet sie auf das, was Sie tippen (vorerst ein Echo).

<!-- Screenshot: wird mit der Szene für den ersten Start ergänzt. -->

## Warum Desk

Stellen Sie sich die Garage eines Builders vor: ein Raum, in dem der Builder in der Mitte arbeitet, ein
Assistent sich erinnert und nachfragt, Roboterarme die Arbeit tun und jede Wand die Arbeit in der Form
zeigt, die der Builder will. Desk ist diese Garage, auf Ihrem Rechner.

- **Ein tägliches Werkzeug.** Builder öffnen es jeden Tag, also lässt es sich vor allem anderen
  installieren, starten und antwortet.
- **Agenten-nativ.** Eris, die ständige Sekretärin, hat ihr eigenes Gedächtnis auf diesem Rechner und
  koordiniert lokale und externe Agenten. Agenten haben Hände; der Mensch entscheidet.
- **Ansichten zuerst.** Daten einmal ordnen und in jeder Form zeichnen: eine eigene Ansicht bauen, Eris
  eine aus einem Satz machen lassen oder eine aus dem Markt installieren.
- **Deins.** Designsystem, Anordnung und Integrationen wählt und ersetzt der Builder.

Desk ist ein Helfer für Builder: Es richtet eine stabile Umgebung zum Bauen ein, lässt sie diese frei
gestalten und ermöglicht ihnen, das beste Produkt in gleichbleibend höchster Qualität zu bauen. Wo Desk
steht und wohin es geht, steht in `docs/roadmap.md`.

## Bauen

```bash
pnpm install
just check && just test
just dev
```

Benötigt werden Rust (die Version ist in `rust-toolchain.toml` festgelegt), Node 22+, pnpm, `just` und
die Tauri-Voraussetzungen für das jeweilige Betriebssystem. Unter macOS laufen die Runtime-Tests in
einem Linux-Container, dafür wird zusätzlich Docker Desktop benötigt. Unter Linux und Windows einmalig
`pnpm --filter @endue-ai/runtime exec playwright install webkit` ausführen. Die Tests laufen mit
`just test-e2e`, nie direkt über Playwright.

## Datenschutz

Desk hat keine Telemetrie. Absturzberichte sind, sobald es sie gibt, Opt-in und standardmäßig
ausgeschaltet.

## Mehr erfahren

- `docs/architecture.md`: wie die Schichten zusammenspielen
- `docs/adr/`: schwer umkehrbare Entscheidungen und ihre Begründung
- `docs/roadmap.md`: warum es Desk gibt, wo es steht und wohin es geht
- `AGENTS.md`: Übersicht über das Repository, Befehle und Regeln (für Menschen und KI-Agenten)
- `CONTRIBUTING.md`: wie sich eine Änderung einreichen lässt

## Lizenz

Der Code steht unter der Lizenz [Apache-2.0](../../../LICENSE). Für die Namen endue und Eris sowie die
Logos und Illustrationen in `brand/` gilt das nicht: siehe [brand/LICENSE](../../../brand/LICENSE) und
[TRADEMARK.md](TRADEMARK.md).
