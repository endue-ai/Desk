# plugins/design

`desk.design`, which design system the desk's components are made of (ADR 0090). A `policy` plugin: no
code, only `contributes.settings` (ADR 0017).

| Setting | Default | Choices |
| --- | --- | --- |
| `desk.design.active` | `""` (endue) | the id of an installed design system plugin (kind `design-system`) |
| `desk.design.markets` | this repository's `market/design-systems/index.json` | https URLs of the design system market indexes the studio's Market tab lists, after `desk.theme.markets` (ADR 0091) |

A theme decides what the tokens hold (colours, the radius and size steps); a design system decides what
each component is made of (which step, which fill, which border). The runtime compiles the design system
in force into `--desk-<component>-*` tokens over the theme's and applies both to the shell and every
plugin frame (`docs/design-system.md`). Installing a design system does not apply it.

Commands (`owner: desk.design`, agent tools per ADR 0088): `desk.design.list` and `.get` (read),
`.use` (`{ "id" }`), `.default` (back to endue), `.set` (`{ "components": { "button": { "shape":
"full" } } }`: changes the person's own design system, or a copy of another), `.export` and `.import`
(`.desk-design` files). The design system studio (`desk.design.studio`) lists, previews, tunes,
describes, imports, exports and installs them from the market. The choice comes back with the session.

```bash
pnpm exec vitest run plugins/design
cargo run -p desk-cli -- plugin validate plugins/design
```
