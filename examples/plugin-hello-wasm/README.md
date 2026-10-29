# examples/plugin-hello-wasm

The smallest logic plugin: a Rust component of the `desk:host` world (`specs/wit`). On start it reads
`hello.txt` from its folder, counts its runs in the store, and shows both as a notification.

| File | Purpose |
| --- | --- |
| `plugin.json` | id `example.hello-wasm`, kind `logic`; may ask for `fs:read` (`${plugin}/hello.txt`) and `ui:notify` |
| `src/lib.rs` | The plugin: bindings from `../../specs/wit`, then `start` |
| `.cargo/config.toml` | Builds for `wasm32-wasip2` into `build/`, so the component lands where `entry` points |
| `build/wasm32-wasip2/release/hello.wasm` | The built component, committed so the host's tests run without the Wasm target |

## Build

Once, add the Wasm target to the toolchain the repository pins (`rust-toolchain.toml` stays as it is):

```bash
rustup target add wasm32-wasip2
```

Then, in this folder, one command builds the component:

```bash
cargo build --release
```

Commit the rebuilt `hello.wasm` together with the source change.

## Check

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-wasm
cargo test -p desk-plugin-host --test hello_wasm
```
