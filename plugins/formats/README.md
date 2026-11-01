# plugins/formats

`endue.formats`, a library plugin (kind `library`): the format readers and decoders several plugins
need, kept once. It runs nothing of its own: no entry, surfaces, contributions or permissions. The
desk installs it like any built-in plugin, never mounts it, never turns it off, and serves its files
at `/endue.formats/...`; its modules run in the frame or worker of the plugin that imports them,
under that plugin's grants. `endue.archives` and `endue.reader` import it.

A consumer's page maps `"@endue-ai/formats/": "/endue.formats/lib/"` in its import map and imports by
the bare specifier; vitest resolves it through an alias and `tsc` through `paths` (repository root),
so tested modules may import it (plain code, no SDK, no DOM). Import maps do not reach workers: a
worker imports `new URL("/endue.formats/lib/<folder>/index.js", import.meta.url)`.

```js
import { decode } from "@endue-ai/formats/codecs/index.js";
import { openSevenZip } from "@endue-ai/formats/sevenzip/index.js";
```

| Folder | Public API |
| --- | --- |
| `lib/codecs/` | `decode`, `decodeStream`, `decodedInput`, `collect`, `CODEC_NAMES` (`index.js`): deflate, zlib and gzip through `DecompressionStream`, bzip2, LZMA, xz (LZMA2, BCJ, delta, CRC32/CRC64), Zstandard, LZ4, LZW; `Input` and its sources (`input.js`), `crc32` (`checksums.js`), raw LZMA and filters (`lzma/index.js`) |
| `lib/sevenzip/` | `openSevenZip(source, name)` (`index.js`): plain and encoded headers, solid blocks, Copy, LZMA, LZMA2, BCJ, Delta, Deflate, BZip2; AES entries are listed as encrypted |
| `lib/rar/` | `openRar`: RAR 4 and 5, solid archives in one pass through `each` (its README) |
| `lib/djvu/` | `openDjvu`: DjVu pages as RGBA, their hidden text and the outline (its README) |
| `lib/disk/` | `openDisk`, `openContainer`, `openFilesystem` (`index.js`): raw, VHD, VHDX, VMDK and QCOW2 images, MBR and GPT, FAT, exFAT, ext and NTFS volumes |
| `lib/apple/` | `openDmg`, `openUdif`, `openHfs`, `openApfs`: DMG (UDIF), HFS+ and HFSX, APFS, decmpfs and LZFSE (its README) |
| `lib/packs/` | `openSquashfs`, `openAppImage`, `openWim`: SquashFS 4.0, Snaps, AppImages and WIM (its README) |

One folder per format family; `tests/manifest.test.ts` keeps `lib/` to these seven. Readers take a
`Source` (`{ size, read(offset, length) }`) and answer the `Archive` shape of
`plugins/archives/ui/formats/archive.js` (`entries`, `details`, `read(entry, limit)`, optional `each`);
`openDjvu` answers pages. Modules import each other by relative paths, never leaving `lib/`; long work
yields, and the RAR, DjVu, disk, Apple and pack readers stop with an `AbortError` on their `signal`.
Damage fails with a sentence. Written from published specifications (`NOTICE` in rar, apple, packs).

```bash
pnpm exec vitest run plugins/formats
cargo run -p desk-cli -- plugin validate plugins/formats
python3 plugins/archives/tests/make-fixtures.py   # codec and 7z fixtures; the others: tests/<folder>/
```
