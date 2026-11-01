# plugins/player

`endue.player`, every video and audio file in one player, in the community folder format and on the
public SDK only. One `center` surface holds one transport, the subtitles drawn over the video, the
playlist and chapters, and an audio file's cover and tags. It plays; it never writes a file.

Media plays through `fs.url` in a `<video>` or `<audio>` element, so a file of any size starts at
once and seeks by HTTP Range. The player's own readers (`ui/probe/`) read the container, codecs,
dimensions, tags and cover from `fs.read` ranges: MP4 and QuickTime, Matroska and WebM, AVI and WAV,
ASF, FLV, MPEG-TS and PS, Ogg, FLAC, MP3 and AAC, AIFF and CAF, APE, WavPack, DSF and DFF, AMR,
RealMedia. What `canPlayType` refuses, or the element's `error` reports, opens as the details view:
"This system's WebKit cannot play Matroska with HEVC and AC-3." MIDI is rendered by a small Web Audio
synthesizer and AU/SND decoded, both into a WAV played the same way.

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
| `ui/player.js`, `load.js`, `model.js`, `access.js` | Requests, opening by format, fs calls and the one ask |
| `ui/probe/`, `format.js`, `codecs.js`, `playable.js` | Detection, the readers, canPlayType and the sentence |
| `ui/subtitles*.js`, `playlists.js`, `text.js` | Cues, playlists, text encodings (UTF-8, UTF-16, EUC-KR) |
| `ui/midi.js`, `synth.js`, `au.js`, `wav.js`, `resume.js` | MIDI, the synthesizer, AU, WAV, kept positions |
| `ui/view*.js`, `keys.js`, `time.js` | The DOM, the transport and its keys |

```bash
pnpm exec vitest run plugins/player   # tests/make-fixtures.sh remakes the ffmpeg fixtures
cargo run -p desk-cli -- plugin validate plugins/player
```
