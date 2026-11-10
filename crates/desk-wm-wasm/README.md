# desk-wm-wasm

`desk-wm` built for `wasm32-unknown-unknown` (#83, ADR 0158): the window manager a desk without the
compositor runs, so the runtime's unit tests, fixture pages and dev page hold no window manager of
their own. One `interact::Wm` per instance, no imports, one JSON call.

## Public API

- Exports `input(len) -> ptr` (a buffer for the request), `call() -> len` (answer it), `output() -> ptr`
  (where the answer is), and the module's `memory`.
- Requests: `{"edit": {"seq", "edits"}}` (the runtime's `Edit`s, answering `{"published": [...]}`),
  `{"took": {"applied", "screen"}}`, `{"run": {"op", ..., "window"}}` (a window command) and
  `{"snapshot": {"titles", "frames"}}` (what `desk.windows.list` answers); anything else answers
  `{"error"}`.
- `answer(wm, text)`: the call in plain Rust. The runtime's side is
  `packages/runtime/src/wm/local.ts`.

## Build and test

```bash
node scripts/desk-wm-wasm.mjs   # builds it when stale; vitest and the fixture server run this
cargo test -p desk-wm-wasm      # the call on the native target
```
