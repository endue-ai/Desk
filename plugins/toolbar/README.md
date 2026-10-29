# plugins/toolbar

The right status panel: a list of drawers, one open at a time. Each drawer has a title and a summary;
opening it shows the rows behind the summary. The open drawer survives a reload (`ctx.state`). It uses
only the public bridge API (`plugin.list`, `plugin.changed`) under the `plugin:manage` permission its
manifest declares.

| Drawer | Summary | Rows |
| --- | --- | --- |
| Plugins | `5 on · 1 off · 1 failed`, with a warning dot while any failed | failed plugins with their reasons, then the ones that are off |
| Access | how many permissions the plugins that are on may ask for | each permission in plain words and the plugins that declare it, with paths, programs and hosts |

Access reads the manifests, so it shows what plugins may ask for, not what was granted: the bridge
lists only the caller's own grants.

| File | Purpose |
| --- | --- |
| `plugin.json` | id `endue.toolbar`, name Status, kind `ui`, permission `plugin:manage`, one `right` surface |
| `ui/drawers.js` | The drawers built from `plugin.list` (no DOM, tested); a new drawer is one function |
| `ui/main.js` | Renders the drawers as buttons with `aria-expanded` and labelled regions |
| `tests/` | `drawers.test.ts` (vitest); the panel on a desk: `packages/runtime/e2e/toolbar.spec.ts` |

Later, each waiting for a bridge API: the brain (local, cloud, offline), tasks, attention, other desks,
the VM, listening, and what the person actually granted (first run, scene 6).

```bash
pnpm exec vitest run plugins/toolbar
cargo run -p desk-cli -- plugin validate plugins/toolbar
```
