# plugins/player

`endue.player`: video and audio in one `center` surface (one transport, subtitles drawn over the
video, the playlist and chapters, a song's cover and tags), on the public SDK only. It never writes.

The readers (`ui/probe/`) read the container, codecs, tags and cover from `fs.read` ranges, and
`ui/route.js` picks the engines, in order (ADR 0050): the engine's `<video>`/`<audio>` on the `fs.url`
URL; the remuxer (`ui/remux/`), which rewrites MKV, WebM, AVI, FLV, Ogg, MXF and MPEG-TS into
fragmented MP4 for Media Source Extensions; FFmpeg's decoders in WebAssembly (`ui/software/`, a
worker), drawn with WebGL and played with Web Audio. A failing engine hands over to the next.

This build's engine is Chromium without its proprietary codecs (ADR 0143, ADR 0174): it plays VP8,
VP9, AV1, Opus, Vorbis, FLAC, MP3 and PCM itself, and FFmpeg adds AAC, AC-3, E-AC-3, DTS, ALAC, WMV,
VC-1, MPEG-4 Part 2, MPEG-1/2, Theora, RealMedia, WMA, APE, WavPack, AMR and DSD; MIDI and AU become
a WAV. **H.264 and HEVC video do not play in this build** (most MP4, MOV, MKV and MTS files from
phones and cameras): such a file opens as details naming the decoder this build lacks, with Show in
Finder for another app; so do protected and damaged files, with why.

Subtitles (SRT, WebVTT, ASS/SSA, SBV, TTML/DFXP, SAMI) named after the video are offered in a menu
with a 0.1 s offset; M3U, PLS, XSPF and CUE play their local entries. Keys: Space or K, Left and
Right 5 s, J and L 10 s, Up and Down, M, Home, End, Page Up and Down, T for theatre, `<` `>` speed,
`[` `]` offset; chords are never taken. Long files offer to resume (`endue.player.resume`). It answers
`desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed` and asks once for a file's folder.
Asleep out of sight (ADR 0070, ADR 0176), the SDK's `keepFiles` keeps each file's position, playlist
entry, subtitles and watch; back, the one on screen opens there paused without asking or taking the
focus, the others when shown. A small window keeps the picture first (`ui/small.css`).

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`) | Tell the desk a file changed on disk (`fs.watch`) |
| `shell:open` (`${home}/**`) | Show in Finder (`ui/reveal.js`); elsewhere the core asks first |

Files: `ui/player.js`, `playing.js`, `keep.js`, `load.js`, `model.js`, `access.js` (requests,
sleep, fs); `route.js`, `codecs.js`, `format.js`, `ui/probe/` (engines); `ui/remux/`, `engines.js`
(MSE); `ui/software/`, `wasm/`, `ui/vendor/ffmpeg/` (LGPL 2.1); `ui/view*.js`, `keys.js` (DOM).

```bash
pnpm exec vitest run plugins/player   # tests/make-*fixtures.sh remake the ffmpeg fixtures
scripts/vendor-ffmpeg.sh              # rebuilds ui/vendor/ffmpeg in Docker (Emscripten)
```
