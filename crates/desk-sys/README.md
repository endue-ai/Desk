# desk-sys

Primitives: fs (notify), proc (portable-pty), net and audio (cpal, wake word), each behind a cargo feature.

Layer: Tauri shell (see `docs/architecture.md`). Status: empty shell, no behaviour yet.

## Public API

- `NAME`: the crate name. Nothing else yet.

## Testing

```bash
cargo test -p desk-sys
```
