# plugins/terminal

`endue.terminal`, the desk's terminal (Emacs's `term`, VS Code's integrated terminal), in the community
folder format and on the public SDK only. Each terminal runs the person's shell in a pseudo-terminal
the core starts with `proc.spawn` (`pty`), types with `proc.write`, follows with `proc.output` and
`proc.exit`, and sizes with `proc.resize`. Several terminals share one surface as tabs, each a desk
buffer (`desk.buffers.open`), so `Mod+B` and `Mod+W` work on them. The requirements are in
`docs/ko/terminal-requirements.md`; why xterm.js is vendored is ADR 0033.

| Permission | Why |
| --- | --- |
| `proc:spawn` (zsh, bash, fish, sh, pwsh, powershell, cmd; `pty`) | Start the shell in a PTY, type into it, resize it, signal it |
| `ui:notify` | The terminal bell, when `endue.terminal.bell` is `notify` |
| `cmd:invoke` (`desk.buffers.open`, `.update`, `.close`) | One desk buffer per terminal, renamed when the shell sets a title |

A shell outside those grants (`endue.terminal.shell`, or a program `endue.terminal.run` names) is
asked for once with `perm.request`; a refusal is said in the terminal: `Not allowed to run fish.`

| Command | What it does |
| --- | --- |
| `endue.terminal.new` (`Mod+Shift+T`), `.focus` (`` Control+` ``), `.close`, `.next`, `.previous` | Terminals as tabs; `.close` sends the shell a hang-up |
| `endue.terminal.clear`, `.interrupt`, `.restart` | Clear the screen; send `int`; start the shell again (Enter after an exit does too) |
| `endue.terminal.run { command, args?, cwd?, title? }` | A program of its own in a new terminal, without a shell; answers `{ session, procId }`. A shell with arguments is refused, so a caller cannot slip past the person |

| File | Purpose |
| --- | --- |
| `ui/sessions.js` | Sessions, proc.* calls and events, the asks, buffers, commands, the reload snapshot (no DOM) |
| `ui/shell.js` · `ui/keys.js` · `ui/theme.js` | The default shell per platform and the settings; which keys the shell, the desk or the clipboard gets; the desk's theme as the terminal's (no DOM) |
| `ui/view.js` · `ui/main.js` | The tab strip and one xterm.js terminal per session; the entry that joins them |
| `ui/vendor/` | xterm.js 6 with the fit and unicode11 addons (MIT), copied by `just vendor-terminal` |

Inside a terminal Escape and Control chords belong to the shell; the desk's own chords (`keys.js`,
plus `endue.terminal.keys-to-desk`) still reach the desk. Copy is `Mod+C` over a selection (and
`Control+Shift+C`), paste `Mod+V` (and `Control+Shift+V`). Settings: `endue.terminal.*` in `plugin.json`.

```bash
pnpm exec vitest run plugins/terminal
cargo run -p desk-cli -- plugin validate plugins/terminal
```
