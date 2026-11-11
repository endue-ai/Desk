# plugins/shell

`desk.shell`, the desk shell's own policy (ADR 0017, 0023). A `policy` plugin: no code, only what it
contributes in `plugin.json`. The shell itself is `mountDesk` in `packages/runtime`.

- **Profiles.** Morning, Deep work, Review, Studio and Night: what each lays out on its desktops
  (`desk.shell.mode`), switched and saved through desk.profiles. Desktops are a named list of up to 32
  (ADR 0117); a profile that names none has four, named 1 to 4. The samples keep the four-desktop
  form (layouts by number), which still loads. A profile's `desk.shell.mode` layers over the
  setting's default, which is what every profile starts from (the old `base` mode). The
  samples turn off `endue.dock`, `endue.sidebar` and `endue.toolbar`: the shell's agent bar, rail and
  bottom edge hold those places. A profile's windows open in front, the last one in use; leaving it,
  they go with it and each plugin's own window is back in its slot (ADR XXXX).
- **Settings.** `desk.shell.mode`; `desk.shell.layouts` (the desktops and layouts changed since the
  profile was saved, as a `desktops` list); `desk.shell.density` (Eris's mesh: airy, balanced,
  dense); `desk.shell.soul` (wisp, solemn).
- **Themes.** `desk.shell.dark` and `desk.shell.light` add the shell's own colours (status dots and
  fills, the secondary surface, the glow, Eris's persona) to desk.theme's, as `--desk-*` custom
  properties. Surfaces every page shares (popover, hover, input, muted, the shadows, the tooltip) are
  desk.theme's role colours (`docs/design-system.md`).
- **Keys.** `Mod+1…9` switch to the first nine desktops and `Mod+Shift+1…9` move the window in use
  there; `Mod+Shift+]` and `Mod+Shift+[` go to the next and previous desktop; `Mod+Shift+\` opens
  the overview. The core keeps `Control+1…4`.

Its commands (`desk.shell.desktop-1` to `-9`, `desktop-new`, `-next`, `-previous`, `-rename`,
`-remove`, `-move-left`, `-move-right`, `-undo`, `desktops-overview`, `move-to-desktop` and `-1` to
`-9`, `desk.shell.density`, `desk.shell.soul`, the agents) and the pane commands under `desk.display`
are defined by the shell at runtime.

```bash
cargo run -p desk-cli -- plugin validate plugins/shell
```
