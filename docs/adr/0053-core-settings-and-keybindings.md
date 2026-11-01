---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# Settings and key bindings belong to the runtime core

## Context and Problem Statement

Settings must remain available without any plugins. ADR 0017 put the default keymap in `desk.keys`,
and ADR 0025 kept personal bindings through `desk.session` and a shell-only editor. Disabling these
plugins must not remove the person's way to configure the desk.

## Decision Drivers

* Settings and keyboard bindings are explicitly required as core functionality.
* Use the macOS System Settings structure: searchable sidebar and grouped detail panels.
* Preserve plugin-contributed keys, init.yaml, profiles and existing personal bindings.

## Considered Options

* Another settings plugin with dependencies on keys and session
* Runtime-owned settings UI, defaults and persistence over the existing core store
* A separate native settings window and a second binding registry

## Decision Outcome

Chosen option: runtime-owned settings and keys. `createRuntime` always installs the settings window,
key commands and default keymap. `Mod+,` opens settings; plugin keys layer over core defaults, and
personal bindings win last. Conflicts require replacement in the editor. The `preferences` record in
`desk`'s core store keeps typed personal settings independently of session restoration, migrating
old `session.parts.keys` when no preference record exists. `desk.keys` is no longer shipped.

### Consequences

* Good: settings and its storage work with zero plugins in both the app and the shell.
* Good: plugins still contribute commands, themes and keys through the existing contracts.
* Cost: settings UI changes ship with the runtime instead of hot-reloading a plugin.

## More Information

[Contract](../../specs/runtime/v0/settings.md). This supersedes the keymap ownership and persistence
parts of ADR 0017 and ADR 0025; their other policies remain in effect. The corresponding source-design
section to reconcile is `docs/ko/desk-structure.md`, “원칙”, item 2 (built-in policies), and its opening
paragraph about every feature being a plugin. The English architecture summary and translations
reflect this exception.
