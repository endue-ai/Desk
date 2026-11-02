# desk-trace

The start-up trace. With `DESK_TRACE=1` (anything but empty or `0`) the app writes each start-up phase
into its data folder as `trace.json`, a Chrome trace (the Trace Event Format's `traceEvents` object)
that chrome://tracing and Perfetto open, and `desk doctor --trace <file>` summarizes one.

Layer: Rust core (see `docs/architecture.md`). Status: used by the app and the CLI.

## Public API

- `Origin::now()`: process start, taken first thing in the app's `run()`; times are µs from it.
- `Trace::from_env(origin, data)` (or `in_dir`, `new`): `phase(name, start)`, `span`, `instant` on
  the core's track; `runtime(time_origin_ms, &[RuntimePhase])` puts the runtime's User Timing
  measures on the same clock (`mount <id>` on a track per plugin, `webview start` filled in) and
  replaces the previous report; `write()` writes the file whole (a temp file renamed over it).
- `summarize(text) -> Summary`: phases by start, marks (`ready line`, the end of
  `first interactive frame`), totals per category, the five longest; `Display` and `to_json`.
- `ENV`, `FILE`, `READY_LINE`, `FIRST_FRAME`, `WEBVIEW_START`, `MOUNT`, `enabled(value)`.

Phases the app writes: core `tauri start`, `core init`, `plugin registry`, `connectors and views`,
`app services`; `webview start`; runtime `webview load`, `bridge connect`, `plugin list`,
`mount <id>`, `session restore`, `agent directory`, `first interactive frame`; the `ready line`.

## Testing

```bash
cargo test -p desk-trace
```

`tests/writer.rs` covers the events, the clocks and the file; `tests/summary.rs` the summary.
