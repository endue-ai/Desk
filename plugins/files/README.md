# plugins/files

`desk.files`, files (like Emacs's `files.el` and `auto-mode-alist`). A `policy` plugin: no code, only
`contributes.settings` (ADR 0017). The desk never reads or writes a file itself: the plugin that opens
it does, under its own `fs:read` and `fs:write` grants, and the desk asks it to.

Which plugin opens a file is each plugin's `contributes.files` rule, `{ "pattern": "*.md", "plugin":
"example.notes" }`: patterns with a slash match the whole path, others the file name, and later layers
are asked first. These defaults add no rule, so files open once a plugin says it opens them.

| Setting | Default | Meaning |
| --- | --- | --- |
| `desk.files.recent-max` | 20 | How many recent files to remember (kept with `store.set`) |
| `desk.files.on-change` | `reload` | Changed on disk: reload when there are no unsaved changes, else ask; `ask`; `ignore` |
| `desk.files.history-max-bytes` | 268435456 (256 MiB) | What the history of earlier versions holds in all; the oldest go first |
| `desk.files.history-max-versions` | 50 | Earlier versions kept per file; `0` keeps none |

Every write the desk makes over a file keeps the bytes it replaces first, in the data folder's
`history/` (ADR 0076): `fs.history` lists them, `fs.restore` and `desk fs restore` put one back.

Commands: `desk.files.open` (`Mod+O`; a path, or one typed in the palette), `.recent` (`Mod+Shift+O`),
`.save` (`Mod+S`), `.revert`, and `.changed { path }`, which a plugin runs when its `fs.watch` reports a
change. The opener answers `desk.files.visit`, `desk.files.save` and `desk.files.revert`, each with
`{ buffer, path }`.

```bash
cargo run -p desk-cli -- plugin validate plugins/files
```
