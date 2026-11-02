# plugins/theme-amber

`endue.theme-amber`, "Amber CRT": an amber phosphor terminal. A `theme` plugin (ADR 0056, ADR 0057): no
code, only the `theme` block in `plugin.json` and the files it names.

| Layer | What it sets |
| --- | --- |
| Palette | Dark: phosphor amber `#ffb84d` on `#120b03`, an amber fill `#ffb000`. Light: dark brown on pale amber `#fff4dc`. Every role colour, the shell's and Eris's tokens |
| Terminal | sixteen warm colours per scheme, amber at their heart |
| Type | IBM Plex Mono for the UI and code, variable roman and italic (`fonts/`) |
| Material | a little grain, an amber glow at the top and around floating layers |
| Backdrop | scanlines per scheme (`images/`, drawn by `scripts/theme-textures.mjs`) |
| Shape, motion | square corners, compact density, snappy motion |

Both schemes pass the theme gate (`@endue-ai/ui/theme`) with no fixes; high contrast is derived by the
gate from the palette.

Choose it with `desk.theme.use` (`{ "id": "endue.theme-amber" }`) or `desk.theme.active:
endue.theme-amber` in `init.yaml`. Licence `Apache-2.0 AND OFL-1.1`: the theme and its tiles are the
repository's, the fonts are OFL (`fonts/OFL.txt`; source and checksums in `fonts/SOURCE.md`).

```bash
pnpm exec vitest run plugins/theme-amber
cargo run -p desk-cli -- plugin validate plugins/theme-amber
```
