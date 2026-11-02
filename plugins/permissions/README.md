# plugins/permissions

The person's view of the permission engine, in the community folder format and on the public bridge
API only. On the right it lists every caller's grants, grouped by caller, and revokes them; the brain's
agents (`agent:<id>`, ADR 0072) come under their own Agents heading, named "Agent <id>". It is also the
prompter: each `perm.prompt` opens the overlay, shows who asks, for what and why, and answers with
`perm.answer`; each `perm.approval` (an agent's irreversible call, ADR 0078) shows the approval card
and answers with `perm.approve`. One card at a time; the rest queue. Escape refuses or denies.

| Permission | Why |
| --- | --- |
| `perm:manage` | `perm.list`, `perm.revoke` of any grant, `perm.prompt` and `perm.answer`, `perm.approval` and `perm.approve` |
| `events:subscribe` (`perm.changed`) | Refresh when any caller's grant changes, not only its own |
| `ui:surface` | Open the `prompt` overlay while prompts wait, close it when the queue is empty |
| `plugin:manage` | Name callers by their manifest name and kind; without it, ids stand in |

| File | Purpose |
| --- | --- |
| `ui/describe.js` | Permissions, scopes, durations and callers in words; which requests are broad |
| `ui/model.js` | The grant list grouped by caller and the prompt in front, with accessible names |
| `ui/approval.js` | The approval card: the agent, the action, the target, the preview, the size; then what a write did |
| `ui/controller.js` | Bridge calls and events, the prompt queue, Escape |
| `ui/view.js` | The DOM: headings, Revoke buttons, an alert dialog and a status live region |
| `ui/main.js` | Mounts the plugin and joins the view to the controller |

A request is broad (CORE-03) when it names a shell or interpreter in `proc:spawn`, a host wildcard over
a top-level domain, a file scope over a disk or the home folder, every command, every plugin's
settings, or `perm:manage`. Focus starts on Don't allow; Tab stays inside the prompt. The reason line
says "none given" when the caller gave none. When the core offers the parent folder (a caller's third
folder under it), an "Allow all of <folder>" button grants that instead (`parent: true`). The approval
card offers "Allow once", "Allow for this task" (only for a call in a turn) and "Deny" (focused);
after an allowed write it shows the path and the size written, and Undo once the core says
`undoable` (`cmd.undo`, #276).

```bash
pnpm exec vitest run plugins/permissions
cargo run -p desk-cli -- plugin validate plugins/permissions
```
