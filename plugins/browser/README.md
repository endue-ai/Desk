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

Not yet: tabs, bookmarks, history, downloads, find, zoom, a page's permission prompts.

| Permission | Why |
| --- | --- |
| `web:browse` | Show web pages in its view; asked once (`perm.request`) when it does not hold it |

| Command | What it does |
| --- | --- |
| `endue.browser.open` | Opens the Browser (`desk.plugins.open`) |
| `endue.browser.go { url }` | Shows an address, or searches for words, in the window in use |
| `endue.browser.reload` | Loads the page again |

| File | Purpose |
| --- | --- |
| `ui/address.js` | What was typed, as an address or a search |
| `ui/browser.js` | The view: open, place, load, steps, what a sleep keeps |
| `ui/view.js`, `ui/main.js` | The toolbar and `#page`; the SDK joined to the behaviour |

```bash
pnpm exec vitest run plugins/browser
cargo run -p desk-cli -- plugin validate plugins/browser
```
