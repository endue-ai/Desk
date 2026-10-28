# plugins/profiles

`desk.profiles`, profiles (like Emacs's `init.el`, switched while Desk runs). A `policy` plugin: no
code, only `contributes.profiles` (ADR 0017). Formerly `plugins/modes`: "mode" means something else in
Emacs, so the plugin set plus settings is called a profile, here and in `init.yaml` (`profile:`).

A profile has an `id`, a `name`, the plugins it turns on and off (`plugins.enabled`, `plugins.disabled`;
plugins it names neither way keep their state) and `settings`, which layer over `init.yaml`'s while it is
in force. `init.yaml`'s `profile` applies at start; `default` when it names none.

| Profile | What it does |
| --- | --- |
| `default` | Nothing: every plugin as installed, every setting as `init.yaml` says |
| `focus` | Do not disturb (`desk.notify.dnd`): only errors show |
| `present` | Light and high contrast, no notifications at all |

Commands: `desk.profiles.switch` (`Mod+Shift+M`, through the palette), `.list`, and `.save`, which keeps
the plugins on and off now and this session's settings as a profile (with `store.set`; a saved profile
replaces a contributed one of the same id). Profiles never turn off `desk.profiles`, `desk.palette` or
`desk.keys`, so there is always a way back. Other plugins may contribute profiles of their own.

The runtime side is `packages/runtime/src/policies/profiles.ts`.

```bash
cargo run -p desk-cli -- plugin validate plugins/profiles
```
