# plugins/island

`desk.island`, the island's settings (ADR 0204): a data-only `policy` plugin. The island itself is the
shell's window (`apps/desk/shell/src/island.rs`) and its page (`apps/desk/src/island.ts`); this folder
declares what a person can change about it, so the settings view lists it like any plugin's.

| Setting | Default | What it does |
| --- | --- | --- |
| `desk.island.show` | `false` | Show the island over every app, on every Space and over full-screen apps |

The island is off by default until it can take the floating Eris's place (ADR 0121): once it talks to
Eris, `desk.island.show` turns on by default and the floating Eris retires.

```bash
pnpm exec vitest run plugins/island
cargo run -p desk-cli -- plugin validate plugins/island
```
