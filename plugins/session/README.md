# plugins/session

`desk.session`, the session (like Emacs's `desktop.el` and `savehist`). A `policy` plugin: no code,
only `contributes.settings` (ADR 0017). The runtime side is `packages/runtime/src/policies/session.ts`.

While Desk runs, the session is kept with `store.set` (in desk-core storage, under the runtime's own
key `session`) a moment after anything worth keeping changes, and once more when the window hides:

- the grid layout (which cell each surface sits in and how big it is)
- the files open in buffers, with the plugin that opened each, in the order they were used
- the surface in use
- the notification history, when `desk.session.save-history` is on

At start, after the plugins have mounted, the files open again through `desk.files.open`, the layout and
the focus come back, and the history is there for `desk.notify.history`. A session that does not match
is skipped and Desk starts as it would without one.

| Setting | Default | Meaning |
| --- | --- | --- |
| `desk.session.restore` | true | Put the last session back at start |
| `desk.session.save` | true | Keep the session as it changes |
| `desk.session.save-history` | true | Keep the notification history across restarts |

Commands: `desk.session.save` (now), `.restore`, `.forget`.

```bash
cargo run -p desk-cli -- plugin validate plugins/session
```
