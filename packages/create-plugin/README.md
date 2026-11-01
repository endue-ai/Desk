# @endue-ai/create-plugin

`pnpm create @endue-ai/plugin <folder>`: scaffold a Desk UI plugin in the same layout as
`examples/plugin-hello-ui`, or with `--kind connector` a Wasm connector in Rust laid out like
`examples/plugin-hello-connector`, ready for `desk plugin validate`.

Layer: Plugins (see `docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Use

The package is not published yet. From this repository:

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --id example.my-plugin
```

`<folder>` must be missing or empty. `--kind` is `ui` (default) or `connector`; `--id` defaults to
`local.<folder>`, the id Desk gives a folder without one; `--name` to the folder name as words;
`--description` is optional. A connector carries `specs/wit` in `wit/`, copied at build time, and
builds with `cargo build --release` once `rustup target add wasm32-wasip2` is done. Exit codes as in
`desk`: 0 ok, 1 the folder was not written, 2 usage.

## Public API

- `main(argv, io)`: the command, with `io` as `{ cwd, out, err }`; `USAGE` is its help text.
- `renderPlugin({ id, name, description?, kind? })`: every file of the folder, path → text.
- `writePlugin(dir, files)`: write them into a missing or empty folder, or throw `FolderError`.
- `defaultId(folder)`, `defaultName(folder)`, `checkId(id)`: the defaults and the manifest id rule.
- `NAME`: the package name.

## Testing

```bash
pnpm exec vitest run packages/create-plugin
```

The tests check every generated `plugin.json` against `specs/plugin/v0` with Ajv, the UI folder
against `examples/plugin-hello-ui`, and the connector's `wit/` against `specs/wit` byte for byte.
