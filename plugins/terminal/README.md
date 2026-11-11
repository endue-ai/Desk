# plugins/terminal

`endue.terminal`, the desk's terminal (Emacs's `term`, VS Code's integrated terminal), in the community
folder format and on the public SDK only. Each terminal runs the person's shell in a pseudo-terminal
the core starts with `proc.spawn` (`pty`), types with `proc.write`, follows with `proc.output` and
`proc.exit`, and sizes with `proc.resize`. Several terminals share one surface as tabs, each a desk
buffer (`desk.buffers.open`), so `Mod+B` and `Mod+W` work on them. The requirements are in
`docs/ko/terminal-requirements.md`; why xterm.js is vendored is ADR 0037, the notifications ADR 0113.

| Permission | Why |
| --- | --- |
| `proc:spawn` (zsh, bash, fish, sh, pwsh, powershell, cmd; `pty`) | Start the shell in a PTY, type into it, resize it, signal it; another program is asked for once (`perm.request`) |
| `ui:notify` | Programs' notifications (OSC 9, 777, 99), the bell, long commands and error exits from a tab nobody looks at |
| `shell:open` (http, https, mailto) | OSC 8 hyperlinks and URLs in the text, on Mod+click |
| `cmd:invoke` (`desk.buffers.open`, `.update`, `.close`) | One desk buffer per terminal, renamed when the shell sets a title |

| Command | What it does |
| --- | --- |
| `endue.terminal.new { cwd? }` (`Mod+Shift+T`), `.focus { session? }` (`` Control+` ``), `.close`, `.next`, `.previous`, `.tabs { query, limit }` | New starts in the folder the tab on screen is in (OSC 7) or `cwd`; `.close` sends a hang-up; `.focus`, `.new`, `.next` and `.previous` bring the window forward; `.tabs` is the palette's Terminals group (`paletteProviders`), whose Enter runs `.focus` |
| `endue.terminal.clear`, `.interrupt`, `.restart`, `.find`, `.rename { session?, title }` | Clear; send `int`; start the shell again; search the scrollback; name the tab |
| `endue.terminal.run { command, args?, cwd?, title? }` | A program of its own in a new terminal, without a shell; answers `{ session, procId }`. A shell with arguments is refused |
| `endue.terminal.sessions`, `.output { session?, chars? }`, `.send { session?, text, enter? }` (`ui/agent.js`) | Agents' tools (ADR 0088); `.run` and `.send` wait for the person's approval of an agent's every call |

| File | Purpose |
| --- | --- |
| `ui/sessions.js` · `pipe.js` · `names.js` · `snapshot.js` · `spawn.js` · `types.js` · `palette.js` | Sessions, proc.* calls (one at a time, in order) and events, OSC, buffers and tab names (zsh, zsh 2), commands, the reload snapshot, the palette's answers (no DOM) |
| `ui/notices.js` · `osc.js` | OSC 9, 777, 99, 7, 133 and 633 read; notices rate limited, de-duplicated, unread per tab; the desk's `desk.notify.open` shows the tab |
| `ui/shell.js` · `keys.js` · `theme.js` · `output.js` | The default shell and the settings; which keys go to the shell, desk, clipboard or search; the theme from `--desk-*` tokens; output decoding |
| `ui/fit.js` · `ime.js` · `paste.js` · `drops.js` · `links.js` · `search.js` | When to refit; IME text sent once; the multi-line paste question; drops (ADR 0119: `desk/paths` typed shell-quoted for the session's shell, text through the paste guard, a tab's OSC 7 folder dragged out as `desk/paths`, link only); links through `shell.open`; search state (no DOM) |
| `ui/view.js` · `tabs.js` · `searchbar.js` · `menu.js` · `main.js` · `style.css` | xterm.js per session, tabs (badges, rename, drag to reorder or out), search bar, right-click menu, the exit banner; the entry; the look from tokens |
| `ui/vendor/` | xterm.js 6 with the fit, unicode11, search and web-links addons (MIT), copied by `just vendor-terminal` |

Escape and Control chords belong to the shell, as do ⌥← and ⌥→ on macOS (ESC b, ESC f: a word); the desk's
own (`keys.js`, `endue.terminal.keys-to-desk`) reach the desk. Copy `Mod+C` over a selection (`Control+Shift+C`), paste `Mod+V` (`Control+Shift+V`),
search `Mod+F` (`Control+Shift+F`). Settings: `endue.terminal.*` in `plugin.json`, applied live.

```bash
pnpm exec vitest run plugins/terminal
cargo run -p desk-cli -- plugin validate plugins/terminal
```
