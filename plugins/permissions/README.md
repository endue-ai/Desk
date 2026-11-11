# plugins/permissions

The person's side of the permission engine, in the community folder format and on the public bridge
API only. Its one surface is a hidden overlay, never a window (ADR XXXX): each `perm.prompt` and each
`perm.approval` (an agent's irreversible call, ADR 0078) shows it in front of everything, whole at any
size, with the keys; the answer goes back with `perm.answer` or `perm.approve`, and with no card left
it hides. One card at a time; the rest queue, and a page that loads again shows the ones still waiting.
Opened by the person (the palette, Eris), it lists every caller's grants, grouped by caller, to revoke;
the brain's agents (`agent:<id>`, ADR 0072) under their own Agents heading; and this session's
refusals, which the core keeps (CORE-03), each with Allow (`perm.grant`) to take it back.

| Permission | Why |
| --- | --- |
| `perm:manage` | `perm.list`, `perm.revoke`, `perm.grant`, `perm.prompt` and `perm.answer`, `perm.approval` and `perm.approve` |
| `events:subscribe` (`perm.changed`) | Refresh when any caller's grant changes, not only its own |
| `plugin:manage` | Name callers by their manifest name and kind; without it, ids stand in |

| File | Purpose |
| --- | --- |
| `ui/describe.js` | Permissions, scopes, durations and callers in words; which requests are broad |
| `ui/model.js` · `ui/approval.js` | The grant list and the prompt; the approval card, then what a write did |
| `ui/refusals.js` | This session's refusals, kept across a reload, and their Allow buttons |
| `ui/overlay.js` | When the overlay shows, hides and shows the list |
| `ui/controller.js` | Bridge calls and events, the card queue, Escape |
| `ui/view.js` · `ui/main.js` | The DOM (dialogs, the list, a status live region); mounting |

A request is broad (CORE-03) when it names a shell or interpreter in `proc:spawn`, a host wildcard over
a top-level domain, a file scope over a disk or the home folder, every command, every plugin's
settings, or `perm:manage`. Focus starts on Don't allow; Tab stays inside the card; Escape refuses,
denies or closes. A press beside a card does nothing. When the core offers the parent folder (a
caller's third folder under it), "Allow all of <folder>" grants that instead (`parent: true`). The
approval card offers "Allow once", "Allow for this task" (only in a turn) and "Deny" (focused); after
an allowed write, the path, the size and Undo once the core says `undoable` (`cmd.undo`, #276).

```bash
pnpm exec vitest run plugins/permissions
cargo run -p desk-cli -- plugin validate plugins/permissions
```
