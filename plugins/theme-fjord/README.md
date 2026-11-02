# plugins/theme-fjord

`endue.theme-fjord`, "Fjord": cool northern blues. A `theme` plugin (ADR 0056, ADR 0057): no code and no
files, only the `theme` block in `plugin.json`.

| Layer | What it sets |
| --- | --- |
| Palette | Dark: deep water `#0f1724`, glacier blue `#7fb8f0`. Light: morning mist `#edf2f7`, fjord blue `#1a5389`. Every role colour, the shell's and Eris's tokens |
| Terminal | sixteen cool colours per scheme, blue and cyan to the fore |
| Backdrop | a gradient per scheme: dusk sky to deep water, or mist |
| Type | Avenir Next where the system has it, else the system's sans-serif |
| Shape, motion | subtle corners, comfortable density, smooth motion |

Both schemes pass the theme gate (`@endue-ai/ui/theme`) with no fixes; high contrast is derived by the
gate from the palette.

Choose it with `desk.theme.use` (`{ "id": "endue.theme-fjord" }`) or `desk.theme.active:
endue.theme-fjord` in `init.yaml`. Licence `Apache-2.0`.

```bash
pnpm exec vitest run plugins/theme-fjord
cargo run -p desk-cli -- plugin validate plugins/theme-fjord
```
