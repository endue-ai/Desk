# plugins/shell

`desk.shell`, the desk shell's own policy (ADR 0017, 0023). A `policy` plugin: no code, only what it
contributes in `plugin.json`. The shell itself is `mountDesk` in `packages/runtime`.

- **Profiles.** Morning, Deep work, Review, Studio and Night: what each lays out on desktops 1 to 4
  (`desk.shell.mode`), switched and saved through desk.profiles. A profile's `desk.shell.mode` layers
  over the setting's default, which is what every profile starts from (the old `base` mode). The
  samples turn off `endue.dock`, `endue.sidebar` and `endue.toolbar`: the shell's agent bar, rail and
  bottom edge hold those places.
- **Settings.** `desk.shell.mode`; `desk.shell.layouts` (desktops moved since the profile was saved);
  `desk.shell.density` (Eris's mesh: airy, balanced, dense); `desk.shell.soul` (wisp, solemn).
- **Themes.** `desk.shell.dark` and `desk.shell.light` add the shell's colours (popovers, status dots,
  Eris's persona) to desk.theme's, as `--desk-*` custom properties.

Its commands (`desk.shell.desktop-1` to `desktop-4`, `desk.shell.density`, `desk.shell.soul`, the
agents) and the pane commands under `desk.display` are defined by the shell at runtime; their keys
are in `desk.keys`.

```bash
cargo run -p desk-cli -- plugin validate plugins/shell
```
