# endue.computer

Eris uses your computer (ADR 0123). The plugin offers her computer-use tools as agent commands
(ADR 0088), which she runs in her agentic loop (ADR 0089), and it holds the Computer page: what macOS
allows, the apps she may operate, Stop and what she did lately. Off until the person opens it.

## Tools

| Command | computer.* | |
| --- | --- | --- |
| `endue.computer.look` | `ax.tree` + `screenshot` | the focused window's elements and the screen; reads only |
| `endue.computer.find` | `ax.find` | elements by role and title; reads only |
| `endue.computer.status` | `permissions.status` | OS permissions, stop state and allowed apps |
| `endue.computer.apps` | `apps.list` | the running apps; reads only |
| `endue.computer.click` | `input.click`, or `ax.perform` for an element | |
| `endue.computer.type` / `keys` / `scroll` | `input.type` / `input.keys` / `input.scroll` | |
| `endue.computer.move` / `drag` | `input.move` / `input.drag` | points on the screen |
| `endue.computer.quit` | `apps.quit` | always asks |
| `endue.computer.open` / `switch` | `apps.launch` or `apps.activate` | |

Acts carry their invocation ID so the core applies the agent's allowlist and records the action
on the runs board. The app list in `endue.computer.apps` narrows each call (empty allows any app).
Move and scroll use no approval card. For a card on one app, the person can approve input for
the rest of the turn or until they stop computer use or change conversations (ADR 0375).

## Banner and stop

`ui/banner.html` is the banner the desk shows above every app while an agent acts (`deskBanner.show`
with `computer.activity`), with Stop; the stop key is Escape held, or `endue.computer.stop-key`.
`endue.computer.stop` and `endue.computer.resume` do the same from the palette.

## Testing

`pnpm exec vitest run plugins/computer`: `tools.test.ts` (the tools map to computer.*),
`banner.test.ts` and `banner-dom.test.ts` (shown while she operates, Stop), `page.test.ts` (the OS
status, ask, open System Settings, the app list), `approval-card.test.ts`, `manifest.test.ts`.
