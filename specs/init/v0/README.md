# Desk init v0

`init.yaml` is a person's own setup, read at every start the way Emacs reads `init.el`.
`init.schema.json` describes the data the file holds once its YAML is parsed; `init.template.yaml` is
the file Desk writes when there is none. Decision: ADR 0016.

## The file

- Lives at `~/.desk/init.yaml`, or wherever `DESK_INIT` points. It belongs to the person: Desk writes
  it only from the template (when it is missing) and when sync pulls a newer copy.
- YAML, one document, a mapping. Booleans are `true` and `false` only (YAML 1.2), never `yes` or `on`.
  Comments are kept, because sync moves the file as text. An empty file, or one with only comments, is
  `{}`: every key takes its default.
- A file that does not parse or does not match the schema is never overwritten. Desk starts with the
  defaults (or keeps the last setup that matched) and reports where the problem is.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | `0` | `0` | Format version; a newer one is refused with "update Desk" |
| `profile` | profile name | `default` | The profile to start in (desk.profiles; ADR 0017) |
| `plugins.disabled` | plugin ids | `[]` | Plugins that start disabled, built-ins included; turning one on while Desk runs lasts until the next start |
| `settings` | key → any value | `{}` | Settings for the core and plugins; keys are lowercase and dotted by owner (`eris.voice`) |
| `sync.enabled` | boolean | `false` | Keep this file the same on every desk, through endue |

Unknown keys are refused, so a typo surfaces instead of being ignored. New keys arrive with a new
`version`; free-form values belong under `settings`.

## Sync

The unit of sync is the whole file, as text. Each desk keeps a base: the revision and digest of the last
text both sides agreed on. endue keeps one copy per person, with a revision that goes up on every
accepted push; a push names the revision it started from and is refused (stale) if endue moved on.

| The file since the base | endue's copy since the base | Result |
| --- | --- | --- |
| same text as endue | any | up to date; the base moves to endue's revision |
| unchanged | changed | pull: the file becomes endue's copy and is in force at once |
| changed | unchanged, or no copy yet | push: endue takes the file |
| changed | changed | conflict: nothing is overwritten; endue's copy is saved as `init.remote.yaml` |

A desk that never synced and whose file holds only defaults (apart from `sync`) pulls instead of
conflicting. A conflict is settled by keeping the local file (it is pushed over endue's copy) or
endue's copy (it replaces the file); the saved copy is removed once settled. A file that does not
match the schema is neither pushed nor pulled. Offline changes nothing. The wire API comes with endue's
sync service (spec first, in `specs/`); until then Desk syncs with a local stand-in.

`vectors/` holds valid and invalid documents for the contract tests in Rust and TypeScript.
