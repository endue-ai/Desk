---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# Plugins read byte ranges, and stream files through short-lived URLs on the plugin scheme

## Context and Problem Statement

`fs.read` returns a whole file as text or base64 in one bridge reply. The file plugins need more:
`endue.player` plays films of several gigabytes and seeks in them, and `endue.archives` reads a zip's
central directory from the file's end. Base64 through the bridge copies every byte four times (disk,
core, JSON, frame) and holds the whole file in memory; a media element cannot play from it at all
without a second copy as a `blob:`. How do plugins read part of a file, and how does a frame play a
file the person granted it?

## Decision Drivers

* A film over 1 GB plays and seeks in a plugin frame, starting within a second, in WKWebView, WebView2
  and WebKitGTK alike
* The grant decides: a URL must not outlive the caller's `fs:read` grant for the path (ADR 0029)
* No new origin, network listener or file system path reachable by a frame's own code
* Additive to bridge v0 (ADR 0004): old callers keep working

## Considered Options

* Ranges in `fs.read` only: the frame reads chunks through the bridge and feeds Media Source
* Tauri's `asset:` protocol with an asset scope, as `convertFileSrc` does
* A loopback HTTP server in the core serving granted files
* Short-lived URLs on the `desk-plugin` scheme, resolved by the core on every request

## Decision Outcome

Chosen option: "short-lived URLs on the `desk-plugin` scheme", with byte ranges in `fs.read` beside
them, because the media element then loads from the scheme the frame already lives on, every request
passes the core's grant check, and nothing else can reach the file.

* `fs.read` gains `offset` and `length`; its result carries the file's `size`. A range past the end
  returns what is there, `length: 0` only the size.
* `fs.url` answers `/_desk/file/<token>/<file name>`, a path the frame resolves against its own
  location, so the core never knows `desk-plugin://localhost` from `http://desk-plugin.localhost`. The
  token is 128 bits from the OS, kept in the core's memory with its caller and path (at most 1024 per
  caller). `Core::file_url` resolves it only while the caller runs and holds an `fs:read` grant that
  covers the path; it ends for good when the caller unloads, the last such grant goes, or the core
  stops. A `once` grant is spent by `fs.url` itself.
* The app answers on a blocking thread: `Accept-Ranges`, `206` with `Content-Range` for one range,
  `416` outside the file, `200` for none or several. Tauri's bodies live in memory, so a part is at
  most 2 MiB and a file over 64 MiB asked without a range gets its first part; media elements ask
  again from where it ended. Files carry `nosniff` and a sandboxing CSP, and their `Content-Type`
  comes from one table in desk-core, which fs.url's `type` reports too.
* The plugin CSP gains `media-src` for the scheme, `blob:` and `data:`, and `blob:` images;
  `connect-src` stays `'none'`, so frame code cannot read a URL's bytes, only media elements can.

### Consequences

* Good, because playing a film reads 2 MiB at a time from disk, seeking is one ranged request, and a
  revoked grant stops the next request.
* Good, because `fs.read` ranges serve readers of headers and trailers (zip, mp4 atoms, EXIF) with no
  new method.
* Bad, because a token is a bearer capability: any frame that learns one can load the file until it
  ends. Tokens are unguessable and per caller, and the core cannot tell which frame asks.
* Bad, because a request without a range for a file over 64 MiB is answered with its first part, which
  only media elements expect, and every part is a new request through the webview's scheme handler.
* Bad, because the browser stub answers `fs.url` with a `data:` URL, so runtime e2e cannot test ranges.

## More Information

Issue #153; `specs/bridge/v0/README.md` (fs.read, fs.url); `crates/desk-core/src/core_fs_url.rs`,
`apps/desk/src-tauri/src/file_urls.rs`. `docs/ko/desk-structure.md` (the bridge and the plugin
scheme) and `docs/architecture.md` (the plugin scheme's paths) should name `/_desk/file/`.
