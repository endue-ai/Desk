# plugins/web

`endue.web` ("Web") opens saved web pages, web archives, link files and feeds read-only, in the
community folder format on the public SDK only. Nothing on a page runs and nothing is fetched.

| Formats | Shown as |
| --- | --- |
| `*.html` `*.htm` `*.shtml` `*.xhtml` `*.xht` | the page, its CSS and images read from its folder |
| `*.mhtml` `*.mht` `*.webarchive` `*.maff`, `*.warc` `*.warc.gz` | the page with resources from the archive; WARC records and MAFF pages listed |
| `*.url` `*.webloc` `*.desktop` `*.lnk` | a card: the target as selectable text, Open for a local file |
| `*.rss` `*.atom`, `*.opml` | entries beside the selected one's content; an outline of feeds |

A page is parsed with `DOMParser`, its sheets (`@import` three levels deep) and images inlined as
`<style>` and `data:` URLs up to 20 MB, and copied by an allowlist sanitizer into a shadow root
(ADR 0044). A bar counts the remote resources left out. `#fragment` links scroll, local links run
`desk.files.open`, other links put their URL on the status line. Source shows the text with line
numbers and tag colours. A file it cannot read opens as its details: name, size, format and why.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`; `.save` is refused.
Files are read with `fs.read` (base64); a refused read asks once for the file's folder.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.open`, `desk.files.changed`) | Open a page's local links; report changes on disk |

| File | Purpose |
| --- | --- |
| `ui/web.js` | The desk's requests, reads with one folder ask, watches |
| `ui/formats.js`, `ui/detect.js` | Bytes to a model, the format from first bytes then extension |
| `ui/archive.js`, `ui/warc.js`, `ui/mime.js`, `ui/plist.js`, `ui/zip.js`, `ui/inflate.js` | Archive readers |
| `ui/links.js`, `ui/lnk.js`, `ui/feeds.js` | Link files and feeds |
| `ui/page.js`, `ui/resources.js`, `ui/sanitize.js`, `ui/allow.js`, `ui/css*.js` | Drawing a page safely |
| `ui/view*.js`, `ui/source.js` | The DOM; `ui/main.js` joins it to the controller |

```bash
pnpm exec vitest run plugins/web     # fixtures: tests/fixtures/make.sh, real.sh
cargo run -p desk-cli -- plugin validate plugins/web
```
