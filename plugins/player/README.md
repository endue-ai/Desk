# plugins/player

`endue.player`, video and audio files in one player, in the community folder format and on the
public SDK only. One `center` surface holds one transport, the subtitles drawn over the video, the
playlist and chapters, and an audio file's cover and tags. It plays; it never writes a file.

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

Subtitles (SRT, WebVTT, ASS/SSA, SBV, TTML/DFXP, SAMI) named after the video in its folder are offered
in a menu, with an offset in 0.1 s steps. M3U, PLS, XSPF and CUE play their local entries in order.
Keys: Space or K, Left and Right 5 s, J and L 10 s, Up and Down, M, Home, End, Page Up and Down (entry
or chapter), T for theatre (Escape leaves), `<` `>` speed, `[` `]` subtitle offset; chords are never
taken. Files over ten minutes are offered to resume (`endue.player.resume`). It answers
`desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`; `.save` is refused. A file outside
its grants: it asks once with `perm.request` for the file's folder (`<folder>/**`).

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`) | Tell the desk a file changed on disk (`fs.watch`) |
| `shell:open` (`${home}/**`) | Show in Finder (`ui/reveal.js`); elsewhere the core asks first |

Files: `ui/player.js`, `load.js`, `model.js`, `access.js` (requests, fs); `route.js`, `playable.js`,
`codecs.js`, `format.js`, `ui/probe/` (engines); `ui/remux/`, `engines.js` (fMP4, MSE); `ui/software/`,
`wasm/`, `ui/vendor/ffmpeg/` (LGPL 2.1); cues, playlists, MIDI, AU; `ui/view*.js`, `keys.js` (DOM).

```bash
pnpm exec vitest run plugins/player   # tests/make-*fixtures.sh remake the ffmpeg fixtures
scripts/vendor-ffmpeg.sh              # rebuilds ui/vendor/ffmpeg in Docker (Emscripten)
```
