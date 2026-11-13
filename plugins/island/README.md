# plugins/island

`desk.island`, the island's settings (ADR 0204): a data-only `policy` plugin. The island itself is the
shell's window (`apps/desk/shell/src/island.rs`) and its page (`apps/desk/src/island.ts`); this folder
declares what a person can change about it, so the settings view lists it like any plugin's.

| Setting | Default | What it does |
| --- | --- | --- |
| `desk.island.show` | `true` | Show the island over other apps while the desk is not in front, on every Space and over full-screen apps |

The island has the floating Eris's place (ADR 0121, ADR 0204): it talks to Eris, and Option+Enter opens
it from any app. Turned off, the floating Eris floats again while the desk is not in front.

```bash
pnpm exec vitest run plugins/island
cargo run -p desk-cli -- plugin validate plugins/island
```
