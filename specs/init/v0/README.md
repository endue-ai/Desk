# Desk init v0

`init.yaml` is a person's own setup, read at every start the way Emacs reads `init.el`.
`init.schema.json` describes the data the file holds once its YAML is parsed; `init.template.yaml` is
the file Desk writes when there is none. Decision: ADR 0016. The desk folder `~/.desk` holds the
person's other files too, each with its schema here: saved profiles (`profile.schema.json`) and key
bindings (`keys.schema.json`). What the person wrote is YAML in the desk folder; what the desk learned
is JSON in the app's data folder (ADR 0079).

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
| `agents.<id>.allow` | permissions | none | What the brain's agent `<id>` may be granted; outside a non-empty list it is refused, inside it the person is asked (ADR 0072). Read again at every agent call |
| `sync.enabled` | boolean | `false` | Keep this file the same on every desk, through endue |

Unknown keys are refused, so a typo surfaces instead of being ignored. New keys arrive with a new
`version`; free-form values belong under `settings`.

A value under `settings` is checked against the setting its owner declares (`contributes.settings`:
kind, choices, minimum, maximum, pattern), not against this schema, so a wrong value never keeps the
file from loading: that one value falls back to its default, and Desk names its file and line
(`settings.invalid`, ADR 0080). A name the setting lists in `renamed` is read as the setting until the
file uses the new one. `vectors/valid/bad-values.json` is such a file.

## Profiles and key bindings

| File | Schema | Written by | Holds |
| --- | --- | --- | --- |
| `~/.desk/profiles/<id>.yaml` | `ProfileFile` | `desk.profiles.save` | `name`, `description`, `plugins.enabled` / `.disabled`, `settings` |
| `~/.desk/keys.yaml` | `KeysFile` | `desk.keys`, when the person rebinds a key | `bindings`: `key`, `mac`, `command`, `args` |

- A profile's file name is its id (`^[a-z0-9][a-z0-9._-]{0,63}$`), so the file holds none; `name`
  defaults to the id. A file of a contributed profile's id shadows that profile; removing the file
  brings the contributed one back.
- `keys.yaml`'s bindings are the person's layer of the keymap, over every plugin's: a later binding of
  the same key wins and `command: ""` takes a key away.
- Both are read at start and again whenever they change on disk, so a hand edit applies at once. Like
  init.yaml, a file that does not parse or does not match its schema is ignored, never overwritten,
  and Desk names the file and the line of the problem. Both carry an optional `version` (0).

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
