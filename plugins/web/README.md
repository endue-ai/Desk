# plugins/web

`endue.web` ("Web") opens saved web pages, web archives, link files and feeds read-only, in the
community folder format on the public SDK only. Nothing on a page runs and nothing is fetched.

| Formats | Shown as |
| --- | --- |
| `*.html` `*.htm` `*.shtml` `*.xhtml` `*.xht` | the page, its CSS and images read from its folder |
| `*.mhtml` `*.mht` `*.webarchive` `*.maff`, `*.warc` `*.warc.gz` | the page with resources from the archive; WARC records and MAFF pages listed |
| `*.url` `*.webloc` `*.desktop` `*.lnk` | a card: the target as selectable text; Open for a local file, Open in browser for http(s) and mailto |
| `*.rss` `*.atom`, `*.opml` | entries beside the selected one's content; an outline of feeds |

Files are read in ranges with the SDK's `readBytes`; a refused read asks once for the folder. A
file over 8 MB that needs no DOM (pages, archives) opens in a worker. A page is parsed into an inert
document (over 2 MB a slice at a time with `document.write`), its sheets and images inlined as
`<style>` and `data:` URLs up to 20 MB, and copied by an allowlist sanitizer into a shadow root (ADR
0044) a few milliseconds at a time; a huge page shows its first 30,000 elements and copies the rest
as it is scrolled to. `<desk-progress>` shows Reading, Opening, Parsing and Drawing; Cancel stops
them and keeps the file on screen. A bar counts remote resources left out. `#fragment` links
scroll, local links run `desk.files.open`, http, https and mailto links open with `shell.open`.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`; `.save` is refused.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.open`, `desk.files.changed`) | Open a page's local links; report changes on disk |
| `fs:read` (asked per folder), `shell:open` (asked by `shell.open` once) | Read files; open http, https and mailto links |

| File | Purpose |
| --- | --- |
| `ui/web.js`, `ui/external.js` | The desk's requests, ranged reads with one folder ask, jobs, links |
| `ui/formats.js`, `ui/detect.js`, `ui/worker.js`, `ui/remote.js` | Bytes to a model, in a worker when large |
| `ui/archive.js`, `ui/warc.js`, `ui/mime.js`, `ui/plist.js`, `ui/zip.js`, `ui/inflate.js`, `ui/links.js`, `ui/lnk.js`, `ui/feeds.js` | Archives, link files, feeds |
| `ui/page.js`, `ui/resources.js`, `ui/sanitize.js`, `ui/allow.js`, `ui/css*.js` | Drawing a page safely |
| `ui/view*.js`, `ui/source.js` | The DOM; `ui/main.js` joins it to the controller |

```bash
pnpm exec vitest run plugins/web     # fixtures: tests/fixtures/make.sh, real.sh
cargo run -p desk-cli -- plugin validate plugins/web
```
