# plugins/theme-glass

`endue.theme-glass`, "Glass": translucent panes over an aurora. A `theme` plugin (ADR 0056, ADR 0057):
no code and no files, only the `theme` block in `plugin.json`.

| Layer | What it sets |
| --- | --- |
| Palette | Dark: night blue `#0b1020`, aurora teal `#6ee7d2`. Light: frosted white over pastels, a bright teal fill. Every role colour, the shell's and Eris's tokens, sixteen terminal colours |
| Material | windows at 72% opacity with a 20 px blur, strong shadows (tinted in light). The desk cannot blur the windows under a window, so it draws each one opaque: its card at 72% over the background (ADR XXXX) |
| Backdrop | an aurora gradient per scheme: night, teal and violet; or blue, mint, lilac and blush |
| Type | the system's sans-serif |
| Shape, motion | round corners, comfortable density, smooth motion |

Both schemes pass the theme gate (`@endue-ai/ui/theme`) with no fixes, and text reads at 4.5:1 or more on
a pane over every stop of the gradient. High contrast is derived by the gate from the palette.

Choose it with `desk.theme.use` (`{ "id": "endue.theme-glass" }`) or `desk.theme.active:
endue.theme-glass` in `init.yaml`. Licence `Apache-2.0`.

```bash
pnpm exec vitest run plugins/theme-glass
cargo run -p desk-cli -- plugin validate plugins/theme-glass
```
