---
status: accepted
date: 2026-11-03
decision-makers: Team endue
---

# A setting value that fails its declaration falls back, and the core names its file and line

## Context and Problem Statement

ADR 0031 put `settings.*` in the core but left values unchecked: `desk.theme.scheme: purple` in
init.yaml reached every caller that asked the core, the runtime silently skipped it (`settings.ts`), and
nobody told the person which line was wrong. A misspelt key was just as silent, and a setting could not
be renamed without breaking every init.yaml that used the old name (SET-04). Who checks a value, what
happens to one that fails, how does the person learn where it is, and how does a rename carry over?

## Decision Drivers

* A wrong line never keeps the desk from starting, and never throws away the rest of the file
* One answer for every caller: the core checks, not each consumer
* The person sees the file and the line, once, not a log flood
* A plugin may be installed later, so a key nobody declares yet is not an error
* No new dependency: lines come from the YAML parser already in use

## Considered Options

* Check in the core: a failing value is skipped so the layer below shows through; refuse it in
  `settings.set`; report each one with its file and line
* Refuse the whole init.yaml, as a schema problem does today
* Keep checking in the runtime only (`fits`) and add ranges and patterns there

## Decision Outcome

Chosen option: "check in the core", because every caller then sees the same value, the file stays in
force, and the core is the one place that reads all the files a value can be written in.

* **Declarations.** `contributes.settings` gains `minimum` and `maximum` (integer and number kinds),
  `pattern` (an ECMA-262 regular expression, as JSON Schema's, for strings) and `renamed` (earlier full
  names, newest first), next to `kind` and `choices`.
* **Resolution** keeps ADR 0031's order, manifest default < init.yaml < set value, and skips a value that
  fails its declaration, so the layer below shows through; for init.yaml that is the default. In each
  layer the setting's own name wins, then its earlier names in order; `settings.get` and `settings.list`
  report `migratedFrom`, and `init.get` hands the value out under the new name and leaves failing ones
  out. A set value counts only under its own owner's name. `settings.set` refuses a failing value with
  the new error code `invalid_value` (WIT logic plugins see `invalid-params` until the WIT world has it).
* **Reports.** The core reads init.yaml, the saved profiles in `~/.desk/profiles` (ADR 0079), the
  profiles plugins contribute in their plugin.json, and the set values. Each problem is logged once per
  run on the `core` channel with owner, key, value, file and line; a value that fell back is also sent
  as `settings.invalid { owner, key, value, reason, file?, line? }` to its owner and to `desk`. Core
  events at start reach nobody, so every `init.get` from `desk` sends desk every problem still in force.
  The app prints the problems at start. `settings.invalid` is not an `events.subscribe` name.
* **Unknown keys.** A name under an installed plugin that declares settings, but not this one, is a
  logged warning naming the nearest declared name (edit distance), with no event: nothing fell back. A
  name under any other owner, `desk` included, is kept silently.
* **Lines** come from yaml_serde: it keeps its parser's marks private but puts the mark of the node being
  read on an error a visitor raises, so a seed walks to the key and raises one there (`init.rs`). The
  same walk reads plugin.json, since YAML reads JSON.

### Consequences

* Good, because `purple` or `"yes"` costs one setting, not the whole file, and the person learns the line.
* Good, because a plugin can rename a setting without breaking anyone's init.yaml.
* Good, because the CLI, plugins and agents that ask the core get checked values like the runtime does.
* Bad, because profiles stay a runtime layer (ADR 0031): the core reports a profile's failing values,
  but the runtime still applies a profile's out-of-range or pattern-failing value until that layer
  moves onto `settings.*`; values of the wrong kind or outside the choices it already skips.
* Bad, because the reports read the profile files and the plugin.json files with profiles on every
  `init.get` and `settings.list`, which costs a few small reads per call.
* Bad, because a manifest's own default is not checked against its declaration.
* Bad, because `minimum` and `maximum` are numbers, so a manifest's `0` comes back as `0.0` through
  `plugin.list`.

## More Information

Issue #289; #290 adds `desk settings lint` and the runtime's notice. Amends ADR 0031 ("values are not
checked yet"); profile files from ADR 0079. Code: `crates/desk-core/src/{settings_check,settings_report,
core_settings,core_init,init}.rs`; tests: `crates/desk-core/tests/settings_{kinds,files,renamed}.rs`,
`e2e/specs/settings.spec.ts`. Requirement SET-04 in `docs/ko/desk-requirements.md`; no section of
`docs/ko/desk-structure.md` changes.
