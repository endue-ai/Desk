# plugins/notify

`desk.notify`, the notification defaults (like Emacs's echo area and `*Messages*`). A `policy` plugin:
no code, only `contributes.settings` (ADR 0017). Plugins notify with `ui.notify` under `ui:notify`; the
core checks the permission and the runtime shows the `ui.notified` event in the status line.

| Setting | Default | Meaning |
| --- | --- | --- |
| `desk.notify.info-ms`, `success-ms` | 4000 | How long they stay, in ms |
| `desk.notify.warning-ms` | 8000 | |
| `desk.notify.error-ms` | 0 | 0 keeps it until it is dismissed |
| `desk.notify.dnd` | false | Do not disturb: hold notifications back |
| `desk.notify.dnd-allows` | `[error]` | Levels that still show during do not disturb |
| `desk.notify.history` | 200 | How many past notifications to keep |

Held notifications go to the history; when do not disturb ends, one line says how many arrived.
Commands: `desk.notify.dismiss`, `.dnd`, `.history` (in the palette when it is on), `.clear`.

```bash
cargo run -p desk-cli -- plugin validate plugins/notify
```
