# plugins/memory

`endue.memory`: the memory inspector. What Eris knows about you, kept on this computer (ADR 0095): the
facts and preferences she remembers and the conversations she keeps. A built-in UI plugin in the
community folder format, on the public bridge only. It autoloads: off until the person opens it
("Memory: What Eris knows" in the palette, `endue.memory.open`), so no window opens at every start.

| Action | Bridge call |
| --- | --- |
| The list, newest first, by kind | `memory.list` |
| Search | `memory.search` (the words a match came from show under the entry) |
| Remember a fact, edit one | `memory.remember` (with the fact's `id` to edit) |
| Forget one, forget everything (after a confirmation) | `memory.forget` (`id`, or `all` with the kind shown) |

`memory.changed` reads the list again, so an edit elsewhere (Eris, `facts.yaml` by hand) shows at once.

| Permission | Why |
| --- | --- |
| `memory:read` | The list, the entries and search |
| `memory:write` | Remember, edit and forget |

| File | Purpose |
| --- | --- |
| `ui/model.js` | Rows from memory entries, who and when for people, the empty and confirmation texts |
| `ui/controller.js` | Reads, searches, edits and forgets through memory.*, and follows memory.changed |
| `ui/view.js` | Search, kind tabs, the list with Edit and Forget, the add field, Forget everything |
| `ui/main.js` | Mounts the plugin and joins the view to the controller |

```bash
pnpm exec vitest run plugins/memory
cargo run -p desk-cli -- plugin validate plugins/memory
```
