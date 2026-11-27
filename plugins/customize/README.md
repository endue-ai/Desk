# plugins/customize

`desk.customize`, the person's own changes to any plugin's page (ADR 0398). A `policy` plugin: no
code, only `contributes.settings`; the runtime side is `packages/runtime/src/policies/customize*.ts`
and the page side `packages/plugin-sdk/src/custom.ts`.

Ask Eris ("make the notes text bigger") or run the commands from the palette. Each plugin gets a style
(CSS, layered after the page's own sheets) and a script (JavaScript, run once per page load after the
plugin mounted, with the plugin's own permissions). Every window of the plugin gets the change at once.

| Command | Does |
| --- | --- |
| `desk.customize.list` | The plugins changed, under the account signed in |
| `desk.customize.get` | One plugin's style, script and entry page |
| `desk.customize.style` | Replace a plugin's style (one undoable step) |
| `desk.customize.script` | Replace a plugin's script: an agent's waits for approval; never `desk.palette` |
| `desk.customize.clear` | Remove both; undo brings the style back, never the script |

Changes are kept in the core's store (`customize`): one set per endue account signed in, one for this
computer while nobody is. They come back at every start and sign-in; an account's first sign-in takes
this computer's set. Safe mode and `desk.customize.enabled: false` apply none, so a broken page still
opens as its plugin draws it. Pages that do not use `@endue-ai/plugin-sdk` get nothing.

| Setting | Default | Choices |
| --- | --- | --- |
| `desk.customize.enabled` | `true` | `false` shows every page as its plugin draws it; nothing kept is lost |

```bash
cargo run -p desk-cli -- plugin validate plugins/customize
pnpm exec vitest run plugins/customize packages/runtime/src/policies/customize.test.ts
```
