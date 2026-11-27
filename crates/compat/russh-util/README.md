# SSH runtime support

This is the Apache-2.0 russh-util 0.52.0 runtime from crates.io. The public runtime and time modules serve the SSH client and server. The WebAssembly clock uses the upstream web-time change from commit `ec0d9a9960a0edc4f0db6f0c217408dde6ff55db`. Native targets use `std::time::Instant`.

The original crate has SHA-256 `668424a5dde0bcb45b55ba7de8476b93831b4aa2fa6947e145f3b053e22c60b6`. Remove this copy once the version selected by russh includes the clock change. Run `cargo test -p desk-ssh` and `cargo check -p russh-util --target wasm32-unknown-unknown`.
