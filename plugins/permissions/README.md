# plugins/permissions

The person's view of the permission engine, in the community folder format and on the public bridge
API only. On the right it lists every caller's grants, grouped by caller, and revokes them. It is also
the prompter: each `perm.prompt` opens the overlay, shows who asks, for what and why, and answers with
`perm.answer`. One prompt at a time; the rest queue. Escape refuses.

| Permission | Why |
| --- | --- |
| `perm:manage` | `perm.list`, `perm.revoke` of any grant, `perm.prompt` events and `perm.answer` |
| `events:subscribe` (`perm.changed`) | Refresh when any caller's grant changes, not only its own |
| `ui:surface` | Open the `prompt` overlay while prompts wait, close it when the queue is empty |
| `plugin:manage` | Name callers by their manifest name and kind; without it, ids stand in |

| File | Purpose |
| --- | --- |
| `ui/describe.js` | Permissions, scopes, durations and callers in words; which requests are broad |
| `ui/model.js` | The grant list grouped by caller and the prompt in front, with accessible names |
| `ui/controller.js` | Bridge calls and events, the prompt queue, Escape |
| `ui/view.js` | The DOM: headings, Revoke buttons, an alert dialog and a status live region |
| `ui/main.js` | Mounts the plugin and joins the view to the controller |

A request is broad (CORE-03) when it names a shell or interpreter in `proc:spawn`, a host wildcard over
a top-level domain, a file scope over a disk or the home folder, every command, every plugin's
settings, or `perm:manage`. Focus starts on Don't allow; Tab stays inside the prompt.

```bash
pnpm exec vitest run plugins/permissions
cargo run -p desk-cli -- plugin validate plugins/permissions
```
