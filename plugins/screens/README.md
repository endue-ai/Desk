# plugins/screens

`endue.screens`, Screen Sharing: another computer's screen in a desk window over VNC (RFB), the
protocol macOS Screen Sharing speaks, in the community folder format and on the public SDK only. Off
until opened (`autoload`). The TCP connection is the core's (`net.connect`, ADR 0133); the vendored
noVNC 1.7 (MPL-2.0) decodes the screen and sends the keyboard and the pointer.

On the other Mac: System Settings › General › Sharing › Screen Sharing. Its sign-in is a macOS user
name and password (Apple Remote Desktop, security type 30); with "VNC viewers may control screen with
password" a VNC password works too (type 2). Passwords are asked each time and never kept.

| Permission | Why |
| --- | --- |
| `net:connect` (`host:port`, asked per computer) | The TCP connection to the other computer's VNC server; `perm.request` at its first connection |

| Command | What it does |
| --- | --- |
| `endue.screens.open` | Show the computers (`desk.plugins.open`) |
| `endue.screens.connect { host?, port?, name?, username? }` | Show that computer's screen (`vnc://user@host:port` works); without `host`, the form opens filled with the rest |
| `endue.screens.disconnect` | End the connection on screen |

While the screen has the focus, every key goes to the other computer, the desk's chords too; View
only gives them back. Fit to window scales the screen; off, it shows at 1:1 and scrolls.

| File | Purpose |
| --- | --- |
| `ui/channel.js` · `ui/codec.js` | `net.*` as the WebSocket-like channel noVNC takes; base64 (no DOM) |
| `ui/computers.js` · `ui/session.js` · `ui/app.js` | Kept computers (store, 64 KiB); one session: the grant, the sign-in, states; commands |
| `ui/view.js` · `ui/main.js` · `ui/index.html` · `ui/style.css` | The page, the questions, the toolbar; the entry; the look from tokens |
| `ui/vendor/novnc/` | noVNC's `core/` and the pako files it imports, copied by `just vendor-novnc` |

```bash
pnpm exec vitest run plugins/screens
node --test scripts/vendor-novnc.test.mjs
cargo run -p desk-cli -- plugin validate plugins/screens
```
