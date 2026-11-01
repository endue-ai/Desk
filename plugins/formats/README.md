# plugins/formats

`endue.formats`, a library plugin (kind `library`): the format readers and decoders several plugins
need, kept once. It runs nothing of its own: no entry, surfaces, contributions or permissions. The
desk installs it like any built-in plugin, never mounts it, never turns it off, and serves its files
at `/endue.formats/...`; its modules run in the frame of the plugin that imports them.

A consumer's page maps `"@endue-ai/formats/": "/endue.formats/lib/"` in its import map and imports by
the bare specifier:

```js
import { decode } from "@endue-ai/formats/codecs/index.js";
import { openSevenZip } from "@endue-ai/formats/sevenzip/index.js";
```

Vitest resolves the same specifier through an alias and `tsc` through `paths` (repository root), so
tested plugin modules may import it: it is plain code, with no SDK and no DOM.

| Folder | Public API |
| --- | --- |
| `lib/codecs/` | `decode`, `decodeStream`, `decodedInput`, `collect`, `CODEC_NAMES` (`index.js`): deflate, zlib and gzip through `DecompressionStream`, bzip2, LZMA, xz (LZMA2, BCJ, delta, CRC32/CRC64), Zstandard, LZ4, LZW; `Input` and its sources (`input.js`), `crc32` (`checksums.js`), raw LZMA and filters (`lzma/index.js`) |
| `lib/sevenzip/` | `openSevenZip(source, name)` (`index.js`): plain and encoded headers, solid blocks, Copy, LZMA, LZMA2, BCJ, Delta, Deflate, BZip2; AES entries are listed as encrypted |
| `lib/rar/`, `lib/djvu/` | `openRar` and `openDjvu`, described in their own READMEs |
| `lib/disk/` | `openDisk`, `openContainer`, `openFilesystem` (`index.js`): disk images and their file systems |

One folder per format family; `apple` and `packs` are taken for the readers to come. Readers take a
`Source` (`{ size, read(offset, length) }`) and answer the `Archive` shape of
`plugins/archives/ui/formats/archive.js` (`entries`, `details`, `read(entry, limit)`, optional
`each`). Modules import each other by relative paths and never leave `lib/`; long work yields to the
event loop. Damaged data fails with a sentence.

```bash
pnpm exec vitest run plugins/formats
cargo run -p desk-cli -- plugin validate plugins/formats
```

`plugins/archives/tests/make-fixtures.py` remakes the codec and 7z fixtures with the real tools.
