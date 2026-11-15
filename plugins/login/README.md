# plugins/login

`desk.login`, the start at login (ADR 0225): a data-only `policy` plugin. The shell registers the
desk with the OS as the setting says (`apps/desk/shell/src/login.rs`, on `desk-sys`'s `login`: a
LaunchAgent on macOS, the Run key on Windows, an XDG autostart entry on Linux); this folder declares
the setting, so the settings view lists it like any plugin's.

| Setting | Default | What it does |
| --- | --- | --- |
| `desk.login.start` | `false` | Start endue at login in the background: no window opens, the island and the shortcuts are there |

The login item starts the desk with `--background`. The desk's page tells the shell the setting when
it starts and when it changes (`apps/desk/src/login.ts`); a development build writes no login item
of the person's.

```bash
pnpm exec vitest run plugins/login
cargo run -p desk-cli -- plugin validate plugins/login
```
