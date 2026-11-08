# endue.computer

Eris uses your computer (ADR 0123). The plugin offers her computer-use tools as agent commands
(ADR 0088), which she runs in her agentic loop (ADR 0089), and it holds the Computer page: what macOS
allows, the apps she may operate, Stop and what she did lately. Off until the person opens it.

## Tools

| Command | computer.* | |
| --- | --- | --- |
| `endue.computer.look` | `ax.tree` + `screenshot` | the focused window's elements and the screen; reads only |
| `endue.computer.find` | `ax.find` | elements by role and title; reads only |
| `endue.computer.apps` | `apps.list` | the running apps; reads only |
| `endue.computer.click` | `input.click`, or `ax.perform` for an element | |
| `endue.computer.type` / `keys` / `scroll` | `input.type` / `input.keys` / `input.scroll` | |
| `endue.computer.open` / `switch` | `apps.launch` or `apps.activate` | |

Every act carries the invocation it serves (`invocationId`), so the core holds it as the invoking
agent's: its allowlist caps it, the person approves it on the permission card ("Allow for this task"
covers the same app until the turn ends), and it is a run on the runs board with a screenshot after
it. The scope of every call is the setting `endue.computer.apps` (bundle ids; empty is every app).
Another plugin cannot use these commands as a deputy.

## Banner and stop

`ui/banner.html` is the banner the desk shows above every app while an agent acts (`deskBanner.show`
with `computer.activity`), with Stop; the stop key is Escape held, or `endue.computer.stop-key`.
`endue.computer.stop` and `endue.computer.resume` do the same from the palette.

## Testing

`pnpm exec vitest run plugins/computer`: `tools.test.ts` (the tools map to computer.*),
`banner.test.ts` and `banner-dom.test.ts` (shown while she operates, Stop), `page.test.ts` (the OS
status, ask, open System Settings, the app list), `approval-card.test.ts`, `manifest.test.ts`.
