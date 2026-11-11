# plugins/session

`desk.session`, the session (like Emacs's `desktop.el` and `savehist`). A `policy` plugin: no code,
only `contributes.settings` (ADR 0017). The runtime side is `packages/runtime/src/policies/session.ts`.

While Desk runs, the session is kept with `store.set` (in desk-core storage, under the runtime's own
key `session`) a moment after anything worth keeping changes, and once more when the window hides:

- what a host keeps as its part: the shell's desktops, drawer and pan, and the plugin windows open
- the files open in buffers, with the plugin that opened each, in the order they were used
- the surface in use
- the notification history, when `desk.session.save-history` is on

At start, after the plugins have mounted, the files open again through `desk.files.open`, all at once
without showing, then each shows in the order they were used, so whichever viewer is ready first the
last one used ends in use and a file that fails does not hold up the others. The layout and the focus
come back, and the history is there for `desk.notify.history`. A session that does not match is
skipped and Desk starts as it would without one. A plugin whose window the session does not show
(closed, or in the drawer) starts asleep, a side one too, so a closed window stays closed until its
first use. The app window's own frame is the shell's, in `<data>/desk-window.json` (ADR XXXX).

| Setting | Default | Meaning |
| --- | --- | --- |
| `desk.session.restore` | true | Put the last session back at start |
| `desk.session.save` | true | Keep the session as it changes |
| `desk.session.save-history` | true | Keep the notification history across restarts |

Commands: `desk.session.save` (now), `.restore`, `.forget`.

```bash
cargo run -p desk-cli -- plugin validate plugins/session
```
