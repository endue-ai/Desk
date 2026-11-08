> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../CONTRIBUTING.md) maßgeblich.

# Zu endue Desk beitragen

Danke für die Unterstützung. Der Einstieg ist `AGENTS.md`: Dort stehen die Übersicht über das
Repository, die Befehle und die Regeln, die für Menschen und KI-Agenten gleichermaßen gelten.

## Bevor es losgeht

- Für alles, was über einen Tippfehler hinausgeht, zuerst ein Issue eröffnen, damit der Umfang
  abgestimmt ist, bevor Code entsteht.
- Fragen gehören in GitHub Discussions; für Sicherheitsmeldungen gilt `SECURITY.md`.

## Befehle

Alle Arbeit läuft über `just`, denselben Einstiegspunkt, den auch die CI verwendet:

```bash
just dev       # run the desktop app
just test      # unit tests (Rust and TypeScript)
just check     # formatting, lints and types
just codegen   # regenerate types from specs/
```

Vor jedem Push `just check && just test` ausführen.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `build:`, `ci:`, `chore:`, optional mit einem Scope wie `feat(runtime):`. Release Notes
  und Versionen werden aus diesen Nachrichten erzeugt.
- [Developer Certificate of Origin](https://developercertificate.org/): Jeden Commit mit
  `git commit -s` abzeichnen (Sign-off). Der Sign-off bestätigt, dass die Änderung selbst verfasst wurde
  oder das Recht besteht, sie unter Apache-2.0 einzureichen. Commits ohne Sign-off können nicht gemergt
  werden.

## Pull Requests

- Ein Anliegen pro PR. Ihn so klein halten, dass er sich in wenigen Minuten lesen lässt.
- Dateien bleiben unter 400 Zeilen; eine Datei aufteilen, bevor sie darüber hinauswächst.
- Die PR-Vorlage ausfüllen, einschließlich der Tabelle „As-is → To-be“: Reviewer lesen die Tabelle zuerst.
- Spec-Änderungen kommen im PR zuerst: `specs/` bearbeiten, `just codegen` ausführen, dann implementieren.
- Tests liegen neben dem Quellcode. Ein PR, der Verhalten ändert, ergänzt oder ändert einen Test, der
  ohne die Änderung fehlschlägt.
- PRs werden per Squash gemergt. Daher wird der PR-Titel zur Commit-Nachricht und muss Conventional
  Commits folgen.

## Lizenz

Mit einem Beitrag gilt als vereinbart, dass er unter Apache-2.0 lizenziert wird. Dateien in `brand/`
sind nicht für Beiträge offen; siehe `TRADEMARK.md`.
