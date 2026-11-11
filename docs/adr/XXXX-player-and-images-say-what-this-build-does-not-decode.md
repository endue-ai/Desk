---
status: proposed
date: 2026-11-12
decision-makers: Team endue
---

# Player and Images say what this build does not decode, until the desk's codecs are decided

## Context and Problem Statement

#162 (findings 3, 4 and 20): since the desk moved from the system's WebKit to Chromium in CEF
(ADR 0143), an H.264 + AAC `.mp4` or `.mov` and an HEVC + AC-3 `.mkv` do not play, and HEIC and
TIFF images do not show. The cards said "This system's WebKit cannot play MP4 with H.264.", naming
an engine the desk no longer runs, and the READMEs still promised those formats.

The CEF the desk ships (`apps/desk/shell/packager/cef.json`: 156.0.26, Chromium 156.0.8078.88, the
standard build from the CEF CDN) is Chromium without its proprietary codecs. Asked in the Player's
page on 2026-11-12, `canPlayType` answers "" and `MediaSource.isTypeSupported` false for `avc1`,
`avc3`, `hvc1`, `hev1`, `mp4a.40.2`, `ac-3`, `ec-3` and `alac`, and "probably" for VP8, VP9, AV1,
Opus, Vorbis, FLAC and MP3. The Player's software decoder (ADR 0050) has AAC, AC-3 and the long
tail, but was built without H.264 and HEVC because WebKit decoded them. In Images'
page `ImageDecoder.isTypeSupported` answers false for `image/heic`, `image/heif` and `image/tiff`
(true for `image/avif` and `image/jxl`): Chromium has no HEIC or TIFF decoder in any build, with or
without its proprietary codecs.

How the desk gets these formats back (D7 of the QA pass's work orders) brings licences and size
that a person has to decide. What do the Player and Images say until then?

## Decision Drivers

* A person who opens a phone's video or photo learns at once, in words, that this build cannot show
  it and why: no blank view, no endless "Loading", no engine they never chose
* The file stays one click from an app that can open it
* No new vendored library and no new licence question before D7 is decided
* The sentences stay true when D7 changes the build: they come from what the engine and the
  decoders answer, not from a list of formats

## Considered Options

* Honest cards now: name the decoder this build lacks, offer Show in Finder, and let the READMEs say
  what this build decodes
* A CEF built with Chromium's proprietary codecs
* Software routes in the plugins: FFmpeg's H.264 and HEVC decoders in the Player's WebAssembly build,
  TIFF and HEIF decoders for Images
* The system converting the file (`sips`, `avconvert`, Quick Look) through `proc.spawn`

## Decision Outcome

Chosen option: "Honest cards now", because it is the one that needs neither a licence nor a size
decision, and it leaves every other option open to D7.

* **Player.** `ui/route.js` asks the engine about the codec of the file's first picture (or, without
  one, of each sound) by a known codec string, in `canPlayType` and in MSE, and looks it up in the
  software decoder's list. When no decoder here takes it, no engine is tried and the details say
  "This build of the desk has no H.264 decoder, so it cannot play this MP4 file." Any other refusal
  says "This build of the desk cannot play …"; the remuxer's failures no longer name WebKit.
* **Images.** A HEIC the webview fails on says "This build of the desk does not decode HEIC images.",
  an EPS's TIFF preview that it fails on says the same of the preview, and anything else the webview
  fails on may be damaged, and says so.
* **TIFF, the one cheap route.** Images already reads uncompressed 8-bit RGB TIFF strips for RAW
  thumbnails (`ui/formats/raw.js`); `ui/formats/tiff-image.js` draws such a TIFF itself, which is
  what `sips` writes by default. Any other TIFF opens as details naming what it is:
  "This build of the desk shows only uncompressed 8-bit RGB TIFF images; this one is
  LZW-compressed." No library is added, and no TIFF goes to the webview, which never decodes one.
* **Show in Finder.** Both details cards have a button, "Show in Finder" ("Show in File Explorer",
  "Show in the file manager" elsewhere): `shell.open` with `reveal: true` for that one file (ADR
  0047), which is only shown, never opened or run. Both manifests declare `shell:open` for
  `${home}/**`, which a built-in plugin holds from its install; a file elsewhere asks the person
  first. `shell.open` opens no `file:` URL, so "Open with the system app" is not offered.
* **READMEs.** `plugins/player/README.md`, `plugins/images/README.md` and `plugins/README.md` list what
  this build decodes and say that H.264 and HEVC video, HEIC and compressed TIFF images do not show.

### What D7 has to weigh

* **A CEF with proprietary codecs** (`proprietary_codecs` and Chrome's FFmpeg branding): H.264 and AAC
  in the engine, HEVC through the system's decoders where it has them, and the remuxer carries
  H.264 and HEVC in Matroska, AVI, FLV and MPEG-TS to MSE again; nothing in the plugins changes. The
  CEF CDN does not publish such builds: the desk would build CEF from source for each platform and
  host it, and shipping those decoders is a patent licensing question. It brings back no HEIC and
  no TIFF image.
* **Software routes.** FFmpeg's `h264` and `hevc` decoders are LGPL 2.1 like the rest of the build:
  two names in `scripts/vendor-ffmpeg.sh` and `SOFTWARE_CODECS` send these files to the existing
  software engine, single-threaded (1080p is likely to drop frames), with the same patent question
  and a larger `ffmpeg.wasm`. Images' TIFF reader would grow by LZW, Deflate (the platform's
  `DecompressionStream`) and PackBits, greyscale, alpha and 16-bit samples, all small; HEIC needs an
  HEVC decoder and HEIF's grid of tiles.
* **The system converting.** No bridge call converts a file; `proc.spawn` of `sips` would give Images
  a process permission it does not have today, and only on macOS.

### Consequences

* Good, because the cards tell the truth in words a person can act on, and the file is one press
  from another app.
* Good, because the sentences follow the engine's own answers: a build with the codecs plays these
  files without a change to the plugins.
* Bad, because the most common video and photo files still do not open in the desk.
* Bad, because the READMEs' lists describe this build and change with D7.
* Neutral, because two built-in plugins now hold `shell:open` for the home folder, for reveals only.

## More Information

Issue #162 (from the QA pass #154), findings 3, 4 and 20; work order B14; decision D7. ADR 0050 (the
software decoder), ADR 0143 (the CEF shell), ADR 0047 (`shell.open`). Code: `plugins/player/ui/`
(`route.js`, `playable.js`, `reveal.js`, `view-panels.js`), `plugins/images/ui/` (`decode.js`,
`cards.js`, `reveal.js`, `formats/tiff-image.js`). Tests: `plugins/player/tests/route.test.ts` (this build's answers),
`view.test.ts`, `reveal.test.ts`; `plugins/images/tests/view.test.ts`, `decode.test.ts`. No section
of `docs/ko/desk-structure.md` changes.
