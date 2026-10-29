# plugins/theme

`desk.theme`, the default themes (like Emacs's `load-theme` and `defface`). A `policy` plugin: no
code, only `contributes.themes` and `contributes.settings` (ADR 0017).

| Setting | Default | Choices |
| --- | --- | --- |
| `desk.theme.scheme` | `dark` | `system` (follow the OS), `light`, `dark` |
| `desk.theme.contrast` | `system` | `system`, `normal`, `high` |
| `desk.theme.motion` | `system` | `system`, `reduce`, `full` |

Themes: `desk.theme.dark` and `desk.theme.light` carry every token; `desk.theme.dark-contrast` and
`desk.theme.light-contrast` layer over them when contrast is high, so they only change a few. A
plugin's theme of the same scheme layers over these, so a theme may change one colour only. Plugins get
the theme as `--desk-*` custom properties on their frame and through `ctx.theme`; reduced motion is
`data-motion="reduce"` on the root.

Commands: `desk.theme.toggle`, `.light`, `.dark`, `.system`, `.contrast`, `.motion`. A change lasts until
Desk quits; set it for good in `init.yaml` (`settings: { desk.theme.scheme: light }`) or a profile.

```bash
cargo run -p desk-cli -- plugin validate plugins/theme
```
