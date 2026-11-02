# @endue-ai/create-plugin

`pnpm create @endue-ai/plugin <folder>`: scaffold a Desk UI plugin in the same layout as
`examples/plugin-hello-ui`, with `--kind connector` a Wasm connector in Rust laid out like
`examples/plugin-hello-connector`, or with `--kind theme` a theme laid out like
`examples/plugin-hello-theme`, ready for `desk plugin validate`.

Layer: Plugins (see `docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Use

The package is not published yet. From this repository:

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --id example.my-plugin
```

`<folder>` must be missing or empty. `--kind` is `ui` (default), `connector` or `theme`; `--id`
defaults to `local.<folder>`, the id Desk gives a folder without one; `--name` to the folder name as
words; `--description` is optional. A connector carries `specs/wit` in `wit/` and builds with
`cargo build --release` once `rustup target add wasm32-wasip2` is done. A theme has every role colour
for both schemes and every other layer at its default, a commented README and the example's
`tests/theme.test.ts`, its imports pointed at this repository. Exit codes: 0 ok, 1 not written, 2 usage.

## Public API

- `main(argv, io)`: the command, with `io` as `{ cwd, out, err, desk? }`; `USAGE` is its help text.
- `renderPlugin({ id, name, description?, kind?, desk? })`: every file of the folder, path → text.
- `writePlugin(dir, files)`: write them into a missing or empty folder, or throw `FolderError`.
- `defaultId(folder)`, `defaultName(folder)`, `checkId(id)`: the defaults and the manifest id rule.
- `NAME`: the package name.

## Testing

`pnpm exec vitest run packages/create-plugin` checks every generated `plugin.json` against
`specs/plugin/v0` with Ajv, the UI folder against `examples/plugin-hello-ui`, the connector's `wit/`
against `specs/wit` byte for byte, the theme through the desk's gate in both schemes, and runs
`examples/plugin-hello-theme`'s test, which the root vitest config does not reach on its own.
