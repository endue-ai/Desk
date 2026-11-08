# desk-crash

Local crash reports (#322). A panic hook and the webview's uncaught errors write
`<data>/crashes/<timestamp>.json`: the version, the OS, the message, a backtrace and the plugins that
were on, with every path under the person's home as `~` and long text cut. Nothing is uploaded (ADR
0007 makes that opt-in later). Knows nothing of Tauri, so the app and `desk doctor` share it. Layer:
Rust, beside the core.

## Public API

- `Context::new(version, commit, home)`, `set_plugins(ids)`: what a report says about the desk; the
  hook reads the plugins without waiting, so a panic while they change reports none.
- `install_hook(data, context)`: every panic writes a `panic` report, then the previous hook runs.
- `Report::panic(...)`, `Report::webview(message, stack, context)`: redacted (`redact`, `cut`) and cut
  at `MESSAGE_MAX` characters and `BACKTRACE_MAX` lines.
- `Crashes::in_data(data)`: `write` (a new file, `-1`, `-2` on a clash; the newest `KEEP` kept),
  `count`, `newest`, `take_unseen` (the newest not shown yet, once; `crashes/.seen` remembers).
- The file carries `schema: 1`; it becomes a spec with the upload task, when another program reads it.

## Testing

```bash
cargo test -p desk-crash
```

`tests/report.rs` covers the fields, the redaction, the cuts, pruning and the unseen report;
`tests/hook.rs` a panic on a thread.
