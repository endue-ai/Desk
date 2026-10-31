---
status: proposed
date: 2026-11-01
decision-makers: Team endue
---

# The web plugin draws sanitized pages in a shadow root

## Context and Problem Statement

`endue.web` opens saved web pages, web archives and feed entries: markup written by anyone, often
with scripts, event handlers and references to the network. The plugin's frame runs with the
plugin's grants, and its CSP (`apps/desk/src-tauri/src/protocol.rs`) allows inline scripts
(`script-src ... 'unsafe-inline'`), forbids nested frames (`frame-src 'none'`), allows images only
from the plugin's folder and `data:`, and fonts only from the plugin's folder. How does a page get
drawn so that nothing in it runs, nothing reaches the network, and it still looks as its author
saw it?

## Decision Drivers

* Nothing on a page runs: a surviving `onerror` or `<script>` would run with the plugin's grants
* Nothing is fetched: no request leaves the desk because a file was opened
* One CSP for every plugin: weakening it for one plugin weakens it for all
* Pages look right: their CSS, images and layout, not a text dump
* No build step, no WebAssembly, no vendored library the frame would have to trust (ADR 0012)

## Considered Options

* An allowlist sanitizer of our own, drawing fresh nodes into a shadow root
* A sandboxed nested frame (`<iframe sandbox srcdoc>`), as browsers' own viewers do
* DOMPurify vendored into the plugin folder (ADR 0037's pattern), output set as `innerHTML`
* Text only: the page's words without its markup

## Decision Outcome

Chosen option: "an allowlist sanitizer drawing into a shadow root", because it keeps the frame's
CSP as it is and the sanitizer never hands markup back to an HTML parser.

* The page is parsed with `DOMParser` (`text/html`, or `application/xhtml+xml` for XHTML) into an
  inert document: no script runs, no image loads, `<noscript>` is parsed as markup.
* `ui/resources.js` reads what the page uses through a resolver: `fs.read` in the page's folder
  for a page on disk, the archive's own records for MHTML, `.webarchive`, WARC and MAFF. Sheets
  (`@import` three levels deep) and images (`src`, `srcset`, `poster`, `background`, CSS `url()`)
  become `<style>` text and `data:` URLs, 20 MB in all. Remote resources are counted, never
  requested.
* `ui/sanitize.js` walks the inert tree and builds a new one from `createElement`/`createElementNS`
  in the plugin's document. Only the elements and attributes in `ui/allow.js` are copied: no
  `script`, `noscript` content, `template`, `iframe`/`frame` (a box links to their source),
  `object`, `embed`, `applet`, `base`, `meta`, `link`, `on*`, `srcdoc`, `formaction`, `action`,
  `target`, `autofocus`; SVG keeps drawing elements, `href` only as `#id`; MathML keeps
  presentation elements, never `annotation-xml`. Links keep `http(s):`, `mailto:` and `file:` as
  resolved by the URL parser (so entity-encoded, tab-split and padded `javascript:` are seen as
  the browser sees them); images keep only `data:image/*`.
* `ui/css.js` cleans every sheet and `style` attribute on a CSS Syntax tokenizer with escapes
  decoded: each URL becomes an inlined `data:` URL, a `#reference` or `none`; `@import` is inlined
  or dropped, `@font-face` and unknown at-rules dropped, `expression()` and bindings dropped,
  rules on `:host`, `::slotted` and `::part` dropped. `html`, `body` and `:root` become the
  `web-html` and `web-body` wrappers that stand in for them.
* The result goes into an open shadow root on an element with `contain: strict`: the page's CSS
  cannot reach the plugin's own interface, its fixed elements stay in its box, and its ids cannot
  clobber the plugin's document. Clicks on links and form submissions are intercepted there; the
  view scrolls to a fragment, opens a local page with `desk.files.open`, or shows the URL.
* `plugins/web/tests/sanitize.test.ts` is the guard: 80 vectors from the OWASP XSS filter evasion
  cheat sheet and DOMPurify's suite (namespace confusion, mXSS through `noscript`, `style`,
  `template`, `svg` and `math`, encoded schemes, `srcdoc`, `xlink:href`, `formaction`, meta
  refresh, `base`, CSS `expression()` and `url(javascript:)`) run through the sanitizer and the
  whole page pipeline in jsdom with scripts enabled, and must leave nothing executable and call
  nothing.

### Consequences

* Good, because the frame's CSP stays the same for every plugin, and the sanitizer's output is
  never parsed again: what is built is what is drawn, so markup that re-parses differently cannot
  change it.
* Good, because saved pages keep their layout, styles and local images, from disk or from inside
  an archive, with no request to the network.
* Bad, because pages that build themselves with JavaScript show only their static HTML, and a bar
  says so.
* Bad, because the allowlist is ours to keep: a new element or attribute shows only once it is
  added, and a mistake in it is a security bug. The vector list grows with every one found.
* Bad, because web fonts are not drawn (`font-src` allows only the plugin's folder) and a page's
  `position: fixed` scrolls with it inside its box.

## More Information

The other options: a sandboxed frame needs `frame-src` opened in the plugin CSP, for every plugin;
DOMPurify is sound but returns markup that is then parsed again into the live document, and it
neither inlines a page's resources nor rewrites its CSS for a shadow root, so most of this work
would remain; text only loses what makes a saved page worth keeping.

`plugins/web/README.md`, `plugins/web/ui/allow.js`, `plugins/web/tests/xss-vectors.ts`;
ADR 0012 (plugins run from their folder), ADR 0037 (vendoring, considered and not taken here).
The OWASP XSS Filter Evasion Cheat Sheet and DOMPurify's test suite are the sources of the vectors.
