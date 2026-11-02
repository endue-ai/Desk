# plugins/player

`endue.player`, every video and audio file in one player, in the community folder format and on the
public SDK only. One `center` surface holds one transport, the subtitles drawn over the video, the
playlist and chapters, and an audio file's cover and tags. It plays; it never writes a file.

The player's readers (`ui/probe/`) read the container, codecs, tags and cover from `fs.read` ranges;
`ui/route.js` then picks the engines, in order (ADR 0050): the webview's `<video>`/`<audio>` on the
`fs.url` URL; the remuxer (`ui/remux/`), which rewrites MKV, WebM, AVI, FLV, Ogg, MXF and MPEG-TS
with codecs WebKit decodes into fragmented MP4 for Media Source Extensions, read by ranges and seeking
by the container's index; and FFmpeg's decoders in WebAssembly (`ui/software/`, a worker), drawn with
WebGL and played with Web Audio, for WMV, RealMedia, OGV, VOB, WMA, APE, WavPack, AMR, DSD and the
rest. A failing engine hands over to the next; protected and damaged files open as details with why.
MIDI is rendered by a small synthesizer and AU decoded, both into a WAV played the same way.

Subtitles (SRT, WebVTT, ASS/SSA, SBV, TTML/DFXP, SAMI) with the video's base name in its folder are
offered in a menu, with an offset in 0.1 s steps. M3U, PLS, XSPF and CUE play their local entries in
order. Keys: Space or K, Left and Right 5 s, J and L 10 s, Up and Down, M, Home, End, Page Up and
Down (entry or chapter), T for theatre (Escape leaves), `<` `>` speed, `[` `]` subtitle offset.
Chords are never taken. Files longer than ten minutes are offered to resume (`endue.player.resume`).
It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`; `.save` is refused. A
file outside its grants: it asks once with `perm.request` for the file's folder (`<folder>/**`).

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`) | Tell the desk a file changed on disk (`fs.watch`) |

| File | Purpose |
| --- | --- |
| `ui/player.js`, `load.js`, `model.js`, `access.js`, `route.js` | Requests, opening, fs calls, engines |
| `ui/probe/`, `format.js`, `codecs.js`, `playable.js` | Detection, the readers, canPlayType |
| `ui/remux/` (`mse.js`), `ui/engines.js`, `view-engine.js` | Demuxers to fMP4, MSE, the engine slot |
| `ui/software/`, `wasm/`, `ui/vendor/ffmpeg/` (LGPL 2.1) | The decoder worker, its glue and FFmpeg |
| `ui/subtitles*.js`, `playlists.js`, `midi.js`, `synth.js`, `au.js` | Cues, playlists, MIDI, AU |
| `ui/view*.js`, `keys.js`, `time.js` | The DOM, the transport and its keys |

```bash
pnpm exec vitest run plugins/player   # tests/make-*fixtures.sh remake the ffmpeg fixtures
scripts/vendor-ffmpeg.sh              # rebuilds ui/vendor/ffmpeg in Docker (Emscripten)
```
