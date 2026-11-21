# Features of endue.database

A feature is a folder here that registers its commands, actions, panels and dialogs: that folder and
one line in `index.js`, in alphabetical order (`export { feature as sessions } from
"./sessions/index.js";`), and nothing else changes. Types: `../feature-host.js`; `diagram/` and
`plans/` are whole ones. `<name>/index.js` exports `feature`:

- `commands(deps)`: handlers by id, each id also in `plugin.json` with a `Database: ` title and
  keywords. A throw is said on the status line and ends the request; `deps.cancelled(text)` thrown
  ends it quietly.
- `actions(deps)`: functions by the name a panel's `act(name, ...args)` or a key calls, guarded the
  same way. An id, an action name, a panel or a dialog type is claimed once.
- `panels`: by type, `{ label, render(doc, state, act, buffer), keep?(state) }`. `render` returns an
  element, or `{ el, update(state), destroy() }` to change in place; `keep` returns the small JSON
  that comes back after a restart (undefined: nothing does).
- `dialogs`: by type, `{ label, render(doc, model, done) }`; `deps.dialog(type, model)` resolves to
  what `done(answer)` gives (undefined: cancelled).
- `styles`: `[new URL("./<name>.css", import.meta.url).href]`, with the theme's `--desk-*` tokens.

`deps`: `bridge`, `commands`, `view`, `manager`, `consoles`, `catalog`, `explorer`, `tools`,
`execute` (every write goes through it, under the read-only, production and agent guards),
`settings()`, `pick`, `confirm`, `dialog`, `say`, `guard`, `cancelled`. A panel is a desk buffer:
`consoles.openPanel(conn, type, "kind: title", state)` opens it once per type and name,
`consoles.updatePanel(id, next)` draws a new state object, and the buffer keeps its state under its
type (`model.sessions`). Heavy work runs in a worker, never in `render`. Tests mount it beside the
others: `mount({ features: [...Object.values(builtins), feature] })`.

```js
export const feature = {
  id: "sessions",
  commands: (deps) => ({
    "endue.database.sessions": async ({ connection }) => {
      const conn = await deps.manager.choose(connection, "Database: sessions of which connection?");
      if (!conn) return undefined;
      const run = await deps.execute(conn, "SELECT pid, state FROM pg_stat_activity");
      const rows = run.result.statements[0]?.sets[0]?.rows ?? [];
      await deps.consoles.openPanel(conn, "sessions", `sessions: ${conn.name}`, { rows });
    },
  }),
  panels: { sessions: { label: "Sessions", render: (doc, state) => listOf(doc, state.rows) } },
};
```
