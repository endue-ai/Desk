# examples/plugin-hello-connector

The smallest connector: a Rust component of the `desk:connector` world (`specs/wit`, ADR 0034).
Each instance reads one folder, its `folder` setting, and turns the `*.md` files at its top into
`note` items: the first `# heading` (or the file name without `.md`) is the title, the text the body,
the file's modification time `updatedAt`, `{ path }` the note's field and a `file://` URL its
`deepLink`. It polls every 300 s; its cursor is the modification time of each file it has reported,
so a sync sends only what changed, 50 files per round. `query` and `act` answer `unsupported`;
`status` checks that the folder is set and can be listed.

| File | Purpose |
| --- | --- |
| `plugin.json` | id `example.hello-connector`, kind `connector`, binding `wasm`, auth `none`, one `note` resource, pull every 300 s, one required setting `folder`; may ask for `fs:read` on `~/**` |
| `src/lib.rs` | The connector: bindings from `../../specs/wit`, then `sync`, `query`, `act` and `status` |
| `notes/` | Two sample notes, one with a heading and one without |
| `.cargo/config.toml` | Builds for `wasm32-wasip2` into `build/`, so the component lands where `entry` points |
| `build/wasm32-wasip2/release/hello_connector.wasm` | The built component, committed so the host's tests run without the Wasm target |

The desk grants `fs:read` for the chosen folder when the person connects it; the manifest only says
how far the connector may ask.

## Run

```bash
cargo test -p desk-plugin-host --test hello_connector
```

## Build

Once, `rustup target add wasm32-wasip2`. Then, in this folder (the remap keeps local paths out, so it
rebuilds alike), and commit the rebuilt `hello_connector.wasm` with any change to `src/` or `specs/wit`:

```bash
RUSTFLAGS="--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo" cargo build --release
```

Check: `cargo run -p desk-cli -- plugin validate examples/plugin-hello-connector`.
