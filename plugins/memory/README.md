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
| Forget one; forget everything, once asked in the page's own dialog | `memory.forget` (`id`, or `all` with the kind shown) |

`memory.changed` reads the list again, so an edit elsewhere (Eris, `facts.yaml` by hand) shows at once.
At the size the desk first opens a window (a 400×263 page) the header keeps two rows and the rest is the list.

| Permission | Why |
| --- | --- |
| `memory:read` | The list, the entries and search |
| `memory:write` | Remember, edit and forget |

| File | Purpose |
| --- | --- |
| `ui/model.js` | Rows from memory entries, who and when for people (never a plugin id), the empty texts, the question |
| `ui/controller.js` | Reads, searches, edits and forgets through memory.*, and follows memory.changed |
| `ui/view.js` | Search, kind tabs, the list with Edit and Forget (a long entry in two lines until Show all), the add field |
| `ui/ask.js` | The yes or no in a `<desk-dialog>`: the page is sandboxed, so `window.confirm` always answers no |
| `ui/main.js` | Mounts the plugin and joins the view to the controller |

```bash
pnpm exec vitest run plugins/memory
just test-e2e memory.spec.ts   # the dialog, the list at the desk's first window size, a long entry
cargo run -p desk-cli -- plugin validate plugins/memory
```
