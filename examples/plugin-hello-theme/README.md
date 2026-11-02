# examples/plugin-hello-theme

The smallest theme with a font and a backdrop: `example.hello-theme`, "Hello theme". A plugin of kind
`theme` (ADR 0056, ADR 0057): no code, only the `theme` block in `plugin.json` and the font it names.

| Layer | What it sets |
| --- | --- |
| Palette | Seventeen roles per scheme: the surfaces, the text, an apricot brand and the borders. Every role it leaves out (status, charts, the shell's and Eris's) keeps the desk's |
| Type | Space Grotesk, one variable font file (`fonts/`), Korean fonts after it |
| Backdrop | a sunrise gradient behind the windows and a warm glow at the top, per scheme |

Everything else (material, shape, motion, terminal) stays at its default.

## Run it

From the repository root, run Desk with this folder as a dev plugin, then choose the theme in the
theme studio (the palette button at the top right) or with the CLI:

```bash
DESK_DEV_PLUGINS=$PWD/examples/plugin-hello-theme just dev
cargo run -p desk-cli -- theme apply example.hello-theme
```

`cargo run -p desk-cli -- cmd run desk.theme.default` (or the endue card in the studio) puts the endue
theme back.

## Check it

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-theme
pnpm exec vitest run --root examples/plugin-hello-theme
```

`tests/theme.test.ts` compiles both schemes and gates them over the endue palette with no fixes; it is
the test `pnpm create @endue-ai/plugin --kind theme` writes. Licence `Apache-2.0 AND OFL-1.1`: the
theme is the repository's, the font is OFL (`fonts/OFL.txt`; source and checksum in `fonts/SOURCE.md`).
Copy this folder to start a theme, or scaffold one; see `docs/plugins/authoring.md` (Making a theme).
