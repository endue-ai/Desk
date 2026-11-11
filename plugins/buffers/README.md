# plugins/buffers

`desk.buffers`, the buffer list (like Emacs's `buffer.el` and `ibuffer`). A `policy` plugin: no code,
only `contributes.settings` (ADR 0017). The list itself lives in the runtime
(`packages/runtime/src/buffers.ts`, `src/policies/buffers.ts`).

A buffer is something open, apart from where it shows: every plugin surface on the grid is one, and a
plugin may open more inside its own surface (a file each, say) with `desk.buffers.open { name, path }`
and mark them changed with `desk.buffers.update { id, modified }`. The ring that `Mod+B`, next,
previous, `Mod+W` and what shows after a close walk holds what shows something: a plugin's surface is
a stop only while the plugin holds no buffer of its own; while it does, the surface stands for the
buffer it shows. `desk.buffers.list` lists every buffer, surfaces too.

| Setting | Default | Meaning |
| --- | --- | --- |
| `desk.buffers.confirm-unsaved` | true | Ask before a buffer with unsaved changes goes (`Mod+W`, its window's ×, a quit): save, discard or keep |
| `desk.buffers.after-close` | `previous` | Show the buffer used before it (`previous`), or nothing (`none`) |

Commands: `desk.buffers.switch` (`Mod+B`, through the palette), `.next`, `.previous`, `.close` (`Mod+W`),
`.list`, and for plugins `.open` and `.update`. The desk asks the plugin that holds a buffer with
`desk.buffers.show { buffer }` and tells it `desk.buffers.closed { buffer }`.

```bash
cargo run -p desk-cli -- plugin validate plugins/buffers
```
