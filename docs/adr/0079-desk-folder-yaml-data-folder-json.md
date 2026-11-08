---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# What the person wrote is YAML in the desk folder, what the desk learned is JSON in the data folder

## Context and Problem Statement

init.yaml (ADR 0016) and the person's views (`~/.desk/views/*.yaml`, ADR 0032) are files the person
owns, but saved profiles and personal key bindings lived only in the core's `store.json`, a JSON blob
in the app's data folder that git cannot diff and a new machine cannot restore. CORE-17 asks for a
settled folder layout with export and import; SY-05 asks for a desk that follows the person to a new
machine. Where does each piece of state live, and in what format?

## Decision Drivers

* A builder's desk should be a folder of text files: readable, editable by hand, diffable with git,
  copied to a new machine as it is.
* What the desk only remembers for itself (grants, the session, histories, caches) must not leak into
  that folder or depend on the person keeping it tidy.
* One rule people can predict, instead of one decision per file.
* Desk never writes init.yaml beyond its template and sync (ADR 0017's rule stays).

## Considered Options

* Keep everything in `store.json` and add an export command that dumps it.
* Move all state into `~/.desk`, JSON and YAML alike.
* Split by authorship: what the person wrote (or asked Desk to write for them) is YAML in `~/.desk`;
  what the desk learned is JSON in the data folder.

## Decision Outcome

Chosen option: "split by authorship", because it gives the person a folder they can read, edit and put
under git, and leaves the desk's own memory where the OS expects application data.

* `~/.desk` (the desk folder): `init.yaml`, `profiles/<id>.yaml` (`desk.profiles.save`), `keys.yaml`
  (`desk.keys`), `views/<id>.yaml`, and `plugins.lock` (the plugin set, written by the core). Each has a
  schema in `specs/init/v0` (views in `specs/view/v0`); each is read at start and again when it changes
  on disk; one that does not parse or check is ignored with a notice naming its line and never
  overwritten. Files Desk writes carry a comment header and put each value on its own line.
* The app's data folder: `store.json` (the session, recent files, what the desk turned on), grants,
  settings set while Desk runs, histories, `secrets.json`, the item index and the person's installed
  themes (ADR 0058). JSON or SQLite, written whenever the desk likes.
* State that was in the store moves to its file once and is then removed from the store.
* The runtime parses and writes YAML with the `yaml` package; its checks are hand-written and held to the
  schemas by the spec's vectors, because a JSON Schema validator compiles code that the webview's CSP
  refuses.

### Consequences

* Good, because `git init ~/.desk` gives a readable history of a desk, and export and import copy one
  folder (plus the data folder only when asked).
* Good, because a hand edit applies without a restart and a broken file never costs the person their text.
* Bad, because the runtime now needs fs:read on `~/.desk/**` and fs:write on `profiles/**` and
  `keys.yaml` (granted by the app, not to plugins), and the runtime ships a YAML parser.
* Bad, because two places to look: a person who wants everything must export with the data folder.

## More Information

Issue #286 (profiles and keys.yaml), #287 (plugins.lock), #288 (export, import, doctor). Requirements
CORE-17 and SY-05 in `docs/ko/desk-requirements.md`. `docs/ko/desk-structure.md` §결정 should gain a
row for the desk folder beside "사람의 설정"; `docs/architecture.md`'s summary is unchanged.
