---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# Plugin frames run workers and WebAssembly, and fetch the desk's file URLs

## Context and Problem Statement

The file plugins read whole files as base64 through the bridge and parse them on the frame's main
thread: a 50 MB JSON takes about 11 s and a 5-million-cell workbook freezes its surface for 31 s with
nothing on screen. The plugin CSP made that the only way. `default-src 'none'` with no `worker-src`
blocks workers (and a sandboxed frame's opaque origin makes `new Worker("desk-plugin://...")`
cross-origin anyway), WebAssembly cannot compile without `'unsafe-eval'`, and ADR 0041 kept
`connect-src 'none'`, so only media elements could read an `fs.url` URL. How do plugins read large
files quickly, show progress, and do heavy work off the main thread?

## Decision Drivers

* A 1 GB file read with progress and Cancel; parsing that does not freeze the surface
* Frames reach nothing outside the desk except through `net.fetch` and its permission check
* WebAssembly decoders for formats WebKit cannot play (`endue.player`, #195), but no JavaScript `eval`
* The same behaviour in WKWebView, WebView2 and WebKitGTK, and in the runtime's e2e server
* One way for every plugin: nine file plugins must not each write their own reader, worker shim and bar

## Considered Options

* Keep base64 `fs.read` and add a streaming bridge method
* `fetch` with `Range` on the `fs.url` URLs: `connect-src` for the desk's scheme only
* Workers: a `blob:` trampoline, `data:` URL workers, or frames with `allow-same-origin`
* WebAssembly: `'wasm-unsafe-eval'`, `'unsafe-eval'`, or JavaScript decoders only

## Decision Outcome

Chosen options: "`fetch` with `Range` on the `fs.url` URLs", "a `blob:` trampoline" and
"`'wasm-unsafe-eval'`", with the SDK owning reading and workers and `@endue-ai/ui` the progress bar,
because the bytes then cross into the frame once, as binary, from the scheme the frame already lives
on, and nothing new is reachable.

* The CSP (`apps/desk/src-tauri/src/plugin-csp.txt`, which the e2e server serves too) gains
  `worker-src blob:` plus the scheme in both forms (WebKit checks a module worker's whole import graph
  against `worker-src`, so the trampoline's import of the plugin file needs it), `'wasm-unsafe-eval'` in
  `script-src`, and `connect-src` for the scheme in both forms. `frame-src` and `form-action` stay
  `'none'`, `'unsafe-eval'` stays out.
* The scheme answers `OPTIONS` preflights (204, `Allow-Headers: Range`, `Max-Age: 600`) and its file
  URLs expose `Content-Range`, `Content-Length` and `Accept-Ranges`.
* `@endue-ai/plugin-sdk`: `readBytes(ctx, file, { onProgress, signal })` reads 2 MiB parts (the
  scheme's `MAX_PART`), the first alone and then four in flight, takes a `200` as the whole file, and
  falls back to ranged `fs.read` as base64 when `fs.url` is refused or `fetch` fails; `byteSource`
  gives the same reads behind a 64 KiB block cache in the `Source` shape of `endue.archives`;
  `startWorker(url)` starts a module worker from a one-line `blob:` module that imports the plugin's
  file, so `import.meta.url` is the file's own and its relative imports work.
* `<desk-progress>` is the one progress UI: a delayed, labelled `progressbar` with detail and Cancel.

### Consequences

* Good, because a read moves binary parts with no base64 or JSON, reports progress after each part,
  and stops on Cancel: in the app a 1 GB file read in 1.2 s (a debug build on macOS, 512 parts), and
  WKWebView sent no preflight for a single byte range. Workers keep the surface drawing while a
  format parses.
* Good, because `connect-src` names only the desk's scheme: other origins stay blocked for `fetch`,
  `XMLHttpRequest`, `EventSource` and `WebSocket`, inside workers too (they inherit the frame's CSP).
* Bad, because frame code can now read the bytes of any file URL whose token it holds, and the scheme's
  other paths (other plugins' files, already loadable as scripts). ADR 0041's "only media elements can
  read a URL" no longer holds; each request still passes the core's grant check for its caller.
* Bad, because `'wasm-unsafe-eval'` lets a frame compile code from bytes it holds. It can already run
  any JavaScript it ships; `eval` and `new Function` stay blocked.
* Bad, because import maps do not reach workers: a worker module imports by URL, not `@endue-ai/...`.
  A worker whose import fails reports only an `error` event without a message.
* Bad, because Tauri's bodies live in memory, so every 2 MiB is one request through the scheme handler,
  and `readBytes` holds the whole file in the frame: formats that need parts use `byteSource`.

## More Information

Issue #180; amends ADR 0041 (`connect-src`); ADR 0012 (UI plugins on `desk-plugin`), ADR 0022
(`@endue-ai/ui` elements). `apps/desk/src-tauri/src/protocol.rs`, `packages/plugin-sdk/src/files.ts`,
`ranges.ts`, `worker.ts`, `packages/ui/src/elements/progress.ts`, `packages/runtime/e2e/frames.spec.ts`.
`docs/ko/desk-structure.md` (the plugin scheme) and `docs/plugins/authoring.md` should name the new
directives and helpers.
