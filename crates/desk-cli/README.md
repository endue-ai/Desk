# desk-cli

The `desk` CLI: dev, plugin validate, brain ping. The hands AI agents use.

Layer: Rust core (see `docs/architecture.md`). Status: `plugin validate`.

## Commands

```bash
desk plugin validate <dir>   # plugin.json against specs/plugin v0, and the entry exists
```

Exit codes: 0 valid (prints `ok <id> <version> (<kind> plugin)`), 1 invalid (every problem on
stderr, each with its location, for example `plugin.json/id: ...`), 2 usage error.

Run it from the repo with `cargo run -p desk-cli -- plugin validate <dir>`. CI runs it for every
folder with a `plugin.json` in `plugins/` and `examples/` (`.github/workflows/plugin-validate.yml`).

## Testing

```bash
cargo test -p desk-cli
```
