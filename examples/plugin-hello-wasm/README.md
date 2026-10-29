# examples/plugin-hello-wasm

The smallest logic plugin: a Rust component of the `desk:host` world (`specs/wit`). On start it
registers the command `example.hello-wasm.greet { name }`, reads `hello.txt` from its folder, counts
its runs in the store, and shows both as a notification. `on-command` answers `greet` with
`"Hello, <name>!"` through `cmd.answer` and writes one log line per call; `on-event` writes one log
line per event, with the event's data as its fields.

| File | Purpose |
| --- | --- |
| `plugin.json` | id `example.hello-wasm`, kind `logic`; may ask for `fs:read` (`${plugin}/hello.txt`) and `ui:notify` |
| `src/lib.rs` | The plugin: bindings from `../../specs/wit`, then `start`, `on_command` and `on_event` |
| `.cargo/config.toml` | Builds for `wasm32-wasip2` into `build/`, so the component lands where `entry` points |
| `build/wasm32-wasip2/release/hello.wasm` | The built component, committed so the host's tests run without the Wasm target |

The command is registered at run time, not listed under `contributes.commands`, so `plugin.json` needs
no permission for it: `cmd.register`, `cmd.answer` and `log.write` touch only the plugin's own data.

## Build

Once, add the Wasm target to the toolchain the repository pins (`rust-toolchain.toml` stays as it is):

```bash
rustup target add wasm32-wasip2
```

Then, in this folder, one command builds it (the remap keeps local paths out, so it rebuilds alike):

```bash
RUSTFLAGS="--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo" cargo build --release
```

Commit the rebuilt `hello.wasm` together with the source change.

## Check

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-wasm
cargo test -p desk-plugin-host --test hello_wasm --test commands --test events
```
