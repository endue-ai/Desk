# plugins/universal

`desk.universal`, Universal View (ADR 0087, ADR 0102, ADR 0103): opens, previews and builds universal views
(`specs/view/v0/universal.schema.json`) on a hidden overlay, with the public SDK only, as a community
plugin would. The desk, Eris, agents and the palette use it by command instead of writing a plugin.

| Command | What it does |
| --- | --- |
| `desk.universal.open` | `{ view }`, `{ id }` (a saved or a plugin's view, or a page of them: ADR 0103), `{ file }`, `{ url }` or `{ data }`; `type`, `title`, `params` (what `{params.<name>}` reads) and `notice` (a line with an action, such as Undo). Opened again under the id and params it is drawn with, it keeps the element and data |
| `desk.universal.build` | The view builder: a source (file, URL, command, items), a shape, the field each role reads, a live preview, then Save as `~/.desk/views/my.<slug>.yaml` (view.save); `{ id }` edits a saved one |
| `desk.universal.drafting`, `desk.universal.preview` | Eris's (ADR 0073): the drafting state at once, then `{ view, note }` with Apply, Try again and Discard, answering the choice |
| `desk.universal.folder` | `{ path }`: a folder as universal data (fs.list), newest first |
| `desk.universal.close`, `desk.universal.allow` | Hide it (`{ id }`: only that view; Escape); ask for the permission a source was refused |

| Permission | Why |
| --- | --- |
| `data:read` | An `items` source |
| `fs:read` (`${home}/**`) | A `file` source, view files, `desk.universal.folder` |
| `cmd:invoke` (`*`) | A `command` source, the view's actions, `move`, `send` and the notice's action |
| `view:manage` | Saved views: `{ id }` and the builder's Save |

A `url` source asks for `net:fetch` on its host when it opens (the notice), so no host is granted ahead.

| File | Purpose |
| --- | --- |
| `ui/open.js` | The arguments as the view they open; the permission a source is read under |
| `ui/screen.js`, `ui/bar.js` | The page: one view under Eris's bar (drafting, preview, notice) and the permission notice |
| `ui/build-model.js`, `ui/builder.js` | The builder's model (fields, roles, suggested map, the view) and its page |
| `ui/folder.js` | A folder's entries as universal data |
| `ui/main.js` | The commands and Escape |

`pnpm exec vitest run plugins/universal`; `cargo run -p desk-cli -- plugin validate plugins/universal`.
