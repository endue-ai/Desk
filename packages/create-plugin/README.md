# @endue-ai/create-plugin

`pnpm create @endue-ai/plugin <folder> --kind <kind>`: scaffold a Desk plugin folder that passes
`desk plugin validate` and carries one test that `desk plugin test` runs.

Layer: Plugins (see `docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Use

The package is not published yet. From this repository:

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --kind view --id example.my-plugin
```

`<folder>` must be missing or empty. `--kind` is `ui` (default; laid out like
`examples/plugin-hello-ui`), `logic` (a Rust component of `desk:host`, like `plugin-hello-wasm`),
`connector` (a Rust component of `desk:connector`, like `plugin-hello-connector`), `view` (like
`plugin-hello-view`), `policy` or `theme` (like `plugin-hello-theme`, its test importing this
repository or `DESK_REPO`). `--id` defaults to `local.<folder>`, the id Desk gives a folder without
one; `--name` to the folder name as words; `--description` is optional. The Rust kinds carry
`specs/wit` in `wit/` and build with `cargo build --release` for `wasm32-wasip2`. Exit codes as in
`desk`: 0 ok, 1 the folder was not written, 2 usage.

## Public API

- `main(argv, io)`: the command, with `io` as `{ cwd, out, err, desk? }`; `USAGE` is its help text.
- `KINDS`: one entry per kind (`about`, `render`, `build`, `dev`, `after`); a new kind is one entry.
- `renderPlugin({ id, name, description?, kind?, desk? })`: every file of the folder, path → text.
- `writePlugin(dir, files)`: write them into a missing or empty folder, or throw `FolderError`.
- `defaultId(folder)`, `defaultName(folder)`, `checkId(id)`: the defaults and the manifest id rule.
- `NAME`: the package name.

## Testing

`pnpm exec vitest run packages/create-plugin` checks every kind's manifest against `specs/plugin/v0`
with Ajv, the layouts against the examples and `specs/wit`, the theme through the desk's gate in
both schemes, and runs `examples/plugin-hello-theme`'s test. `cargo test -p desk-cli --test
templates` scaffolds every kind, builds the Rust ones and runs `desk plugin validate` and `test`.
