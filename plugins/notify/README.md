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
| `desk.notify.system` | `background` | When one also goes to the system's notifications: `background`, `always`, `never` |

Held notifications go to the history; when do not disturb ends, one line says how many arrived.
A notice that stays until it is dismissed (an error by default, or one with actions) has a Dismiss
button, and a newer notice covers it only for its own time. In the shell the status line is a card at
the top centre, one line until it is pointed at or focused, then the whole of it.
By default, shown notices also go to the OS while Desk is in the background (ADR 0240). Clicking
one brings Desk forward and runs its first action or opens the notice.
The notification centre holds the history (#307): a bell right after the status line counts what
arrived since it was last open, and it or Mod+Shift+N opens a panel of them, Today and Earlier,
each with its plugin, time, actions and Dismiss, with Clear all and do not disturb in its header.
Commands: `desk.notify.dismiss`, `.dnd`, `.history` (opens and closes the centre; `{ "show": false }`
only answers it), `.clear`.

```bash
cargo run -p desk-cli -- plugin validate plugins/notify
```
