# plugins/theme

`desk.theme`, the endue theme (like Emacs's `load-theme` and `defface`). A `policy` plugin: no code, only
`contributes.themes` and `contributes.settings` (ADR 0017).

| Setting | Default | Choices |
| --- | --- | --- |
| `desk.theme.scheme` | `dark` | `system` (follow the OS), `light`, `dark` |
| `desk.theme.contrast` | `system` | `system`, `normal`, `high` |
| `desk.theme.motion` | `system` | `system`, `reduce`, `full` |
| `desk.theme.active` | `""` (endue) | the id of an installed theme plugin (kind `theme`, ADR 0056) |
| `desk.theme.markets` | this repository's `market/themes/index.json` | https URLs of the market indexes the studio's Market tab lists, in order: the first to list an id wins (ADR 0060) |

Themes: `desk.theme.dark` and `desk.theme.light` carry every role colour of the design system, the
`colors` of `@endue-ai/ui` (`docs/design-system.md`): surfaces, text, the primary action, four statuses
with their ink, text, soft surface and border, structure (`border`, `input`, `ring`), floating layers
and eight chart colours, and the terminal's sixteen ANSI colours (`ansi0` to `ansi15`).
`desk.theme.dark-contrast` and `desk.theme.light-contrast` layer over them when contrast is high, so
they only change a few. A plugin's theme of the same scheme layers over these, so a theme may change one
colour only. The dark set equals the package's defaults; a test keeps the two in step and checks every
text and surface pair in both schemes.

Plugins get the theme as `--desk-*` custom properties on their frame (the type, space and radius scale
too) and through `ctx.theme`; reduced motion is `data-motion="reduce"` on the root and zeroes the
`--desk-motion-*` tokens.

Commands: `desk.theme.toggle`, `.light`, `.dark`, `.system`, `.contrast`, `.motion`, `.use` (`{ "id" }`,
an installed theme plugin) and `.default` (back to endue). The theme chosen (`desk.theme.active`) comes
back with the session. A scheme, contrast or motion change, by command or in Settings, is the person's
own: Desk keeps it in the preferences record across quits, over `init.yaml` and the profile
(`specs/runtime/v0/settings.md`). `init.yaml` (`settings: { desk.theme.scheme: light }`) or a profile
gives the value until the person changes it.

```bash
cargo run -p desk-cli -- plugin validate plugins/theme
```
