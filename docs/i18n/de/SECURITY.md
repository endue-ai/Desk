> Dies ist eine Übersetzung. Bei Abweichungen ist die [englische Fassung](../../../SECURITY.md) maßgeblich.

# Sicherheitsrichtlinie

## Eine Sicherheitslücke melden

Bitte kein öffentliches Issue eröffnen. Meldungen bitte vertraulich, auf einem dieser Wege:

- E-Mail an team@endue.ai mit „security“ im Betreff.
- Oder über die GitHub-Schaltfläche „Report a vulnerability“ im Tab „Security“ dieses Repositorys.

Bitte angeben, was gefunden wurde, wie es sich reproduzieren lässt, welche Version und welches
Betriebssystem betroffen sind und welche Auswirkungen zu erwarten sind.

## Wie es weitergeht

| Schritt | Ziel |
| --- | --- |
| Eingangsbestätigung | innerhalb von 3 Arbeitstagen |
| Erste Bewertung und Schweregrad | innerhalb von 10 Arbeitstagen |
| Fix veröffentlicht | so schnell, wie es der Schweregrad erfordert |
| Öffentliche Offenlegung | sobald ein Fix ausgeliefert wird, spätestens 90 Tage nach der Meldung |

Meldende werden in den Release Notes genannt, sofern sie nicht ausdrücklich darauf verzichten.

## Unterstützte Versionen

Desk liegt vor Version 1.0. Nur das jeweils neueste Release jedes Kanals (stable, beta, canary) erhält
Sicherheitskorrekturen.

## Geltungsbereich

Im Geltungsbereich: die Desktop-App, die Rust-Crates, die TypeScript-Pakete, die eingebauten Plugins und
das Berechtigungsmodell der Bridge (greift ein Plugin oder Agent ohne Berechtigung auf ein Primitiv zu,
ist das eine Sicherheitslücke).

Nicht im Geltungsbereich: Plugins von Drittanbietern sowie Dienste außerhalb dieses Repositorys (diese
bitte unter derselben Adresse an endue melden).
