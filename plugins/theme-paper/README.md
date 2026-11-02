# plugins/theme-paper

`endue.theme-paper`, "Paper & Ink": warm paper and ink-blue accents. A `theme` plugin (ADR 0056,
ADR 0057): no code, only the `theme` block in `plugin.json` and the files it names.

| Layer | What it sets |
| --- | --- |
| Palette | Light: paper `#f3ede1`, ink `#1f1a14`, ink blue `#1f3a8f`. Dark: lamp-lit brown `#1b1814`, cream text, pale ink blue. Every role colour, the shell's and Eris's tokens, sixteen terminal colours |
| Type | Literata, variable roman and italic (`fonts/`), Korean serif fonts after it |
| Material | grain (`noise` 0.05 light, 0.06 dark) and warm soft shadows |
| Backdrop | a paper tile per scheme (`images/`, drawn by `scripts/theme-textures.mjs`) |
| Shape, motion | soft corners, comfortable density, calm motion |

Both schemes pass the theme gate (`@endue-ai/ui/theme`) with no fixes; high contrast is derived by the
gate from the palette, so it keeps the ink blue at 7:1.

Choose it with `desk.theme.use` (`{ "id": "endue.theme-paper" }`) or `desk.theme.active:
endue.theme-paper` in `init.yaml`. Licence `Apache-2.0 AND OFL-1.1`: the theme and its tiles are the
repository's, the fonts are OFL (`fonts/OFL.txt`; source and checksums in `fonts/SOURCE.md`).

```bash
pnpm exec vitest run plugins/theme-paper
cargo run -p desk-cli -- plugin validate plugins/theme-paper
```
