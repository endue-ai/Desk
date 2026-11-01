---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# The player remuxes first and decodes what WebKit cannot with FFmpeg in WebAssembly

## Context and Problem Statement

`endue.player` claims every common video and audio file, but WebKit plays only what its platform's
media stack reads: on macOS that is MP4 and QuickTime, WebM, MP3, AAC, FLAC, WAV, AIFF and Ogg audio.
MKV, AVI, WMV and ASF, FLV, OGV, RM and RMVB, MXF, MPEG-PS, and the audio files WMA, APE, WavPack,
MKA, AMR, DSF and DFF opened as details. Many of these hold codecs WebKit decodes in hardware (an MKV
with HEVC and AAC); the rest need decoders WebKit does not have (VC-1, MPEG-4 Part 2, RealVideo,
Theora, WMA, Monkey's Audio, DSD). How does a plugin play them without a native binary, without GPL
code, and without the repository's Apache-2.0 code becoming something else?

## Decision Drivers

* Every file the player claims plays and seeks; damaged, encrypted and DRM files say why
* Hardware decoding where the system has it: battery, heat, 4K
* A plugin folder runs as it is (ADR 0012), in a sandboxed frame without cross-origin isolation, so
  WebAssembly runs single-threaded (ADR 0048)
* The repository stays Apache-2.0; no GPL, nonfree or unRAR code; third-party code is replaceable
* The vendored binary is small, reproducible and checked

## Considered Options

* Remux first, then FFmpeg's decoders in WebAssembly for the rest
* FFmpeg in WebAssembly for everything (demux and decode all files in software)
* An FFmpeg binary beside the desk, reached through a new bridge method
* Decoders written in JavaScript, codec by codec

## Decision Outcome

Chosen option: "Remux first, then FFmpeg's decoders in WebAssembly", because the system's decoders
play most of these files once the container is rewritten, and the long tail of codecs needs a decoder
library that no one could write again.

* `ui/route.js` orders the engines per file: the webview where `canPlayType` is sure; the remuxer for
  Matroska/WebM, AVI, FLV, Ogg, MXF and MPEG-TS whose codecs MSE takes (H.264, HEVC, VP9, AV1, AAC,
  Opus, FLAC, ALAC, AC-3, E-AC-3, PCM as `ipcm`); the software decoder for the rest; the element last
  for containers WebKit's stacks do not read although `canPlayType` says "maybe" (AVI on macOS). An
  engine that fails hands the file to the next one; none left opens the details with the reason.
* The remuxer (`ui/remux/`) is the plugin's own code, written from the container specifications. It
  reads by ranges through `byteSource`, seeks by the container's index and writes fragmented MP4 that
  `ManagedMediaSource` (or `MediaSource`) plays, attached with `srcObject`: WebKit does not attach a
  MediaSource through the `blob:` URL of a sandboxed frame's opaque origin. A sound MSE refuses beside
  a picture it takes (MP3, DTS, Vorbis) is decoded by the software decoder and kept on the video's clock.
* The software decoder is FFmpeg 9.0.2, unmodified, configured with `--disable-everything` and only
  the decoders, demuxers and parsers the player needs (VC-1/WMV, MPEG-4 Part 2, H.263, Theora, VP6,
  RealVideo, MPEG-1/2 and more; WMA, APE, WavPack, AMR, DSD, Vorbis, Cook and more), without
  libswscale or libswresample, compiled with Emscripten into a standalone `ffmpeg.wasm` with the
  player's C glue (`plugins/player/wasm/`). It runs in a worker (`startWorker`), reads by synchronous
  Range requests, and the frame draws the frames with WebGL and plays the sound with Web Audio on the
  audio clock, dropping frames when the machine is too slow and saying so once.
* `scripts/vendor-ffmpeg.sh` rebuilds it in a pinned Emscripten container from the pinned release
  (URL and SHA-256); `plugins/player/ui/vendor/ffmpeg/VERSIONS` records the release, the image, the
  configure and link lines and the SHA-256 of the glue and of every vendored file, and
  `scripts/vendor-ffmpeg.test.mjs` fails `just test-unit` when the copy, the glue or the LGPL-only
  configuration drift.

### LGPL 2.1 compliance

* Everything enabled is LGPL 2.1 or later: the script and its test refuse `--enable-gpl`,
  `--enable-nonfree`, `--enable-version3` and every external library, and FFmpeg's configure refuses
  GPL parts without `--enable-gpl`. `COPYING.LGPLv2.1` ships beside the binary.
* The library is a separate file loaded at run time through a small documented interface (the `dk_*`
  exports and the `env.dk_read` import of `ui/software/ffmpeg.js`): a person can build FFmpeg with
  their own changes, link the same glue and replace `ffmpeg.wasm`, which is what section 6 asks of a
  work that uses the library. The glue's source and the build script are in the repository.
* FFmpeg's sources are the unmodified release at the recorded URL and SHA-256. A release of the desk
  that ships the player must also offer that source (the tarball beside the release, or a written
  offer), as sections 4 and 6 require of whoever distributes the binary.
* The player's own code (routing, remuxer, glue, worker, view) stays Apache-2.0; nothing is ported
  from FFmpeg or any GPL or LGPL source.

### Consequences

* Good, because MKV, AVI, FLV, MXF and MPEG-TS with common codecs play on the system's hardware
  decoders, seek in a fraction of a second and cost no WebAssembly at all.
* Good, because the long tail (WMV, RealMedia, OGV, VOB, WMA, APE, WavPack, AMR, DSD) plays without a
  native binary, in the same transport, with the same subtitles, playlists, resume and tags.
* Bad, because the vendored binary adds about 2.6 MiB to the repository and is updated by rebuilding.
* Bad, because the decoder is single-threaded: 1080p VC-1 or MPEG-2 may drop frames on slower machines,
  and the sound's pitch follows the speed setting on the software path.
* Bad, because H.264, HEVC and Opus are not in the software build (WebKit decodes the first two; FFmpeg's
  Opus decoder needs libswresample): a file whose only engine would be software decoding of them opens
  as details.
* Bad, because synchronous Range requests from the worker depend on the desk's scheme answering them;
  when they fail the whole file is read into memory first.

## More Information

Issue #195; ADR 0048 (workers, WebAssembly and `fetch` in plugin frames), ADR 0041 (ranged reads and
file URLs), ADR 0037 (vendoring into a plugin folder). `plugins/player/ui/route.js`, `ui/remux/`,
`ui/software/`, `plugins/player/wasm/`, `scripts/vendor-ffmpeg.sh`.
