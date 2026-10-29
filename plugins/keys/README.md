# plugins/keys

`desk.keys`, the default keymap (like Emacs's `bindings.el` and `global-map`). A `policy` plugin: no
code, only `contributes.keys` in `plugin.json` (ADR 0017). `Mod` is Command on macOS and Control
elsewhere; a binding's `mac` key replaces `key` on macOS.

| Key | Command |
| --- | --- |
| `Mod+K`, `Mod+Shift+P` | `desk.palette.open` (M-x) |
| `Escape` | `desk.keys.quit` (C-g: hide the palette, dismiss a notification) |
| `Mod+/` | `desk.keys.list` |
| `Mod+B`, `Mod+W` | `desk.buffers.switch`, `desk.buffers.close` |
| `Mod+Alt+ArrowRight`, `Mod+Alt+ArrowLeft` | `desk.buffers.next`, `desk.buffers.previous` |
| `Mod+O`, `Mod+S`, `Mod+Shift+O` | `desk.files.open`, `desk.files.save`, `desk.files.recent` |
| `Mod+Shift+L` | `desk.theme.toggle` |
| `Mod+Shift+N`, `Mod+Shift+D` | `desk.notify.history`, `desk.notify.dnd` |
| `Mod+Shift+M` | `desk.profiles.switch` |

Other plugins add bindings in their own `contributes.keys`; a later layer's binding of the same key
wins, and `"command": ""` takes a key away. Keys pressed inside a plugin's frame reach the keymap too
when they hold Command, Control or Alt, or are Escape, unless the plugin handled them. A key whose
command is off (its policy plugin is disabled) does nothing and passes on.

The runtime side is `packages/runtime/src/keymap.ts` and `src/policies/keys.ts`.

```bash
cargo run -p desk-cli -- plugin validate plugins/keys
```
