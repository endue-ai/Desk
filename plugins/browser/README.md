# plugins/browser

`endue.browser` ("Browser"): surf the web in a desk window. A built-in UI plugin in the community
folder format, on the public SDK and bridge only. It autoloads: off until the person opens it.

The page is not this plugin's. It is a web view of the desk's (`web.*`, ADR 0216): a browser of its
own that the desk draws over `#page`, with nothing of the desk in it (no bridge, no desk scheme, its
own cookies). This page holds the toolbar and asks for addresses.

| Does | How |
| --- | --- |
| Opens on | the address kept over a sleep, else `endue.browser.home` (own value, init.yaml, default `https://endue.ai/`; empty opens none) |
| An address typed | http or https as it is; a host gets `https://` (`http://` for `localhost` and plain numbers); anything else is searched for with `endue.browser.search` (`%s` is the words) |
| Back, forward, reload, stop | `web.go`; the buttons follow `web.changed`, reload is stop while a page loads |
| Enter | loads and gives the page the keys (`web.focus`); a press on the toolbar takes them back; Escape puts the page's address back |
| A window out of the canvas | says the page shows in the desk only |
| The assistant in the page | `web.read` and `web.act` (ADR 0270): the page as text with its elements named by a ref, then acts on a ref; each command answers the page as it reads once it rests, 4000 characters a part (`more` reads on) |

Not yet: tabs, bookmarks, history, downloads, find, zoom, a page's permission prompts, frames read.

| Permission | Why |
| --- | --- |
| `web:browse` | Show web pages in its view; asked once (`perm.request`) when it does not hold it |
| `web:control` | Read the page and act in it for the assistant; asked once when it does not hold it |

| Command | What it does |
| --- | --- |
| `endue.browser.open` | Opens the Browser (`desk.plugins.open`) |
| `go { url }`, `reload`, `back`, `forward` | Shows an address or searches, loads again, steps through the history; agent tools. `stop` stops a load |
| `read { from?, chars? }` | The page's address, title, scroll and text; agent tool, read only |
| `scroll { to?, pages?, ref? }` | A step, an end, or an element into view; agent tool |
| `click { ref }`, `type { text, ref?, replace?, submit? }`, `key { key, ref? }`, `select { ref, option }` | Act in the page; agent tools an agent's call waits for approval on (`irreversible`, ADR 0078) |

`ui/address.js`: what was typed. `ui/browser.js`: the view (open, place, load, steps, when a page
rests). `ui/agent.js`: the assistant's commands. `ui/view.js`, `ui/main.js`: the toolbar, the SDK.

```bash
pnpm exec vitest run plugins/browser
cargo run -p desk-cli -- plugin validate plugins/browser
```
