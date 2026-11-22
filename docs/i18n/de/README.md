> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../README.md) maßgeblich.

# endue

Eine App, die ein OS ist.

**Keine festen Bildschirme.** endue ist eine Rust-Shell auf Chromium und ein kleiner Rust-Kern mit einer Web-Runtime
darüber, und jede Funktion oberhalb davon, die eingebauten eingeschlossen, ist ein Plugin, das sich im
laufenden Betrieb ersetzen lässt. Wie bei Emacs: Der Kern enthält nur Primitive (Dateien, Prozesse,
Netzwerk, Audio, Fenster), und alles andere ist Code, der sich ohne Neustart ändern lässt.

> Status: Pre-Alpha. `just dev` öffnet die Arbeitsfläche mit Eris und dem ersten Start; starten Sie vorher `just brain-echo`, dann antwortet sie auf das, was Sie tippen (vorerst ein Echo).

<!-- Screenshot: wird mit der Szene für den ersten Start ergänzt. -->

## Die endue-App installieren oder aktualisieren

Die grafische Anwendung Desk heißt jetzt endue. Unter [v0.3.0](https://github.com/endue-ai/endue/releases/tag/v0.3.0) finden Sie macOS-Disk-Images für Apple-Chips (`aarch64`) und Intel (`x86_64`). Vergleichen Sie die SHA-256-Prüfsumme des passenden Images mit `SHA256SUMS-macos` auf der Release-Seite. Öffnen Sie dann das Image und kopieren Sie endue Desk in den Ordner „Programme“. Version v0.3.0 wurde von Apple nicht notarisiert. Blockiert macOS den ersten Start der geprüften App, wählen Sie in den Systemeinstellungen unter „Datenschutz & Sicherheit“ für endue Desk „Dennoch öffnen“.

Sobald die erste Desktop-Version unter dem Namen **endue app** erscheint, wählen Sie unter [GitHub Releases](https://github.com/endue-ai/endue/releases) das Installationspaket für Ihr Betriebssystem und Ihren Prozessor und gehen wie folgt vor.

- Beenden Sie Desk unter macOS, öffnen Sie das neue `.dmg` und starten Sie `Install endue.command`. Das Installationsprogramm erkennt eine vorhandene Kopie im Programme-Ordner an der Bundle-ID, auch wenn Sie sie umbenannt haben. Bei mehreren Kopien oder einer anderen App namens endue öffnen Sie ein Terminal im eingebundenen Disk-Image und führen `"./Install endue.command" --to "/Applications/Studio.app"` aus. Ersetzen Sie den Beispielpfad durch den Pfad zur bestehenden Desk-App oder einen freien Namen.
- Verwenden Sie unter Windows und Linux das bisherige Paketformat, sofern die Version es anbietet. Windows behält das Installationsverzeichnis bei. Das Debian-Paket heißt weiterhin `endue-desk`.
- Beim nächsten Start verwendet die App Ihre Profile und `plugins.lock` in `~/.desk` sowie die bisherigen Einstellungen, Berechtigungen und Verweise auf Anmeldedaten. Ältere Desk-Versionen wie v0.3.0, die nur als Installationspaket ausgeliefert wurden, aktualisieren Sie manuell mit dem neuen Paket.

Der offizielle Befehl heißt `endue`. Im Quellverzeichnis können Sie ihn mit `cargo run -p desk-cli -- --help` ausprobieren. Die Disk-Images von v0.3.0 enthalten die CLI noch nicht. Bestehende Skripte können `desk` in der aktuellen Hauptversion weiter verwenden.

### Linux-Server mit x86_64

Wenn eine Version **endue CLI for Linux x86_64** anbietet, laden Sie das Archiv, die Signatur und `SHA256SUMS-cli` in ein leeres Verzeichnis. Prüfen Sie das Archiv mit `sha256sum -c SHA256SUMS-cli` und entpacken Sie es mit `tar -xzf endue-cli_*_linux-x86_64.tar.gz`. Setzen Sie `ENDUE_BRAIN_URL` auf die Adresse Ihres brain-v0-Dienstes und führen Sie `./endue-cli_*/bin/endue run "hello"` aus. Die Version v0.3.0 enthält nur die macOS-App. [Signatur des Herausgebers prüfen](../../releasing.md#verify-a-linux-cli-download)

## Warum endue

Stellen Sie sich die Garage eines Builders vor: ein Raum, in dem der Builder in der Mitte arbeitet, ein
Assistent sich erinnert und nachfragt, Roboterarme die Arbeit tun und jede Wand die Arbeit in der Form
zeigt, die der Builder will. endue ist diese Garage, auf Ihrem Rechner.

- **Ein tägliches Werkzeug.** Builder öffnen es jeden Tag, also lässt es sich vor allem anderen
  installieren, starten und antwortet.
- **Agenten-nativ.** Eris, die ständige Sekretärin, hat ihr eigenes Gedächtnis auf diesem Rechner und
  koordiniert lokale und externe Agenten. Agenten haben Hände; der Mensch entscheidet.
- **Ansichten zuerst.** Daten einmal ordnen und in jeder Form zeichnen: eine eigene Ansicht bauen, Eris
  eine aus einem Satz machen lassen oder eine aus dem Markt installieren.
- **Deins.** Designsystem, Anordnung und Integrationen wählt und ersetzt der Builder.

endue ist ein Helfer für Builder: Es richtet eine stabile Umgebung zum Bauen ein, lässt sie diese frei
gestalten und ermöglicht ihnen, das beste Produkt in gleichbleibend höchster Qualität zu bauen. Wo endue
steht und wohin es geht, steht in `docs/roadmap.md`.

### Ihr Desktop ist ein Ordner

Alles, was Sie gestalten, liegt in `~/.desk`: `init.yaml`, Ihre Profile, `keys.yaml`, Ihre Ansichten und
`plugins.lock`, einfache Dateien zum Lesen, Bearbeiten und Versionieren mit git. `endue export
<Ordner|Datei.zip>` nimmt sie auf einen anderen Computer mit (`--with-data` auch den eigenen Zustand des
Desktops, nie Geheimnisse), `endue import` holt sie zurück, ohne Ihre `init.yaml` zu überschreiben, und `endue
doctor` listet jede Datei und ob sie sich so liest, wie ihre Spezifikation es sagt.

## Bauen

```bash
pnpm install
just check && just test
just dev
```

Benötigt werden Rust (die Version ist in `rust-toolchain.toml` festgelegt), Node 22+, pnpm, `just` sowie
cmake und ninja für das Chromium der App (CEF), das ihr erster Build herunterlädt; unter Linux außerdem die
Header von GTK 3, xdo, AppIndicator und ALSA. Die Runtime-Tests laufen in einem Headless-Chromium in der
Version der App, das `just test-e2e` einmalig nach `~/.cache/desk` holt. Die Tests laufen mit
`just test-e2e`, nie direkt über Playwright.

## Datenschutz

endue hat keine Telemetrie. Absturzberichte sind, sobald es sie gibt, Opt-in und standardmäßig
ausgeschaltet.

## Mehr erfahren

- `docs/architecture.md`: wie die Schichten zusammenspielen
- `docs/adr/`: schwer umkehrbare Entscheidungen und ihre Begründung
- `docs/roadmap.md`: warum es endue gibt, wo es steht und wohin es geht
- `AGENTS.md`: Übersicht über das Repository, Befehle und Regeln (für Menschen und KI-Agenten)
- `CONTRIBUTING.md`: wie sich eine Änderung einreichen lässt

## Lizenz

Der Code steht unter der Lizenz [Apache-2.0](../../../LICENSE). Für die Namen endue und Eris sowie die
Logos und Illustrationen in `brand/` gilt das nicht: siehe [brand/LICENSE](../../../brand/LICENSE) und
[TRADEMARK.md](TRADEMARK.md).
