# lib/packs

File systems and images that pack a tree of files into one file: SquashFS 4.0 (alone, as a Snap,
or after an AppImage's ELF runtime) and WIM (Windows images). Plain JavaScript over a `Source`
(`{ size, read(offset, length) }`), no SDK and no DOM. Written from the formats' published
descriptions (`NOTICE`); no code of squashfs-tools, wimlib or liblzo2 was used or followed.

## API

```js
import { openAppImage, openSquashfs, openWim } from "@endue-ai/formats/packs/index.js";

const fs = await openSquashfs(source, { signal, format: "Snap" });
const app = await openAppImage(source, { signal }); // runtime facts, then its file system
const wim = await openWim(source, { signal }); // one top folder per image: "1 Windows 11 Pro"
await fs.read(entry, limit, { signal }); // one file's bytes (its first `limit` of them)
```

Each answers the `Archive` shape of `plugins/archives/ui/formats/archive.js`. Opening reads the
superblock or header and the tables (inodes, folders, ids, fragments, export; the WIM lookup table,
XML and image metadata), never file data; a read decodes only the blocks or chunks it needs. Work
yields to the event loop every 25 ms and stops with an `AbortError` when `signal` fires. Damage
fails with a sentence. Devices, pipes and sockets are listed with a refusal.

SquashFS blocks: gzip (zlib), xz, LZ4 and Zstandard through `lib/codecs`, LZO1X here (`lzo.js`).
Refused with a sentence: big-endian and pre-4.0 images, legacy LZMA (compression 2). AppImages of
type 1 (ISO 9660) are refused; the SquashFS of type 2 is found by its `hsqs` magic past the ELF.
WIM resources: stored, XPRESS Huffman (`xpress.js`, [MS-XCA]) and LZX (`lzx.js`, as WIM uses it).
LZMS and solid resources (`.esd`) are listed with "LZMS compression is not read yet."; split WIMs
(`.swm`) are refused.

## Tests

`pnpm exec vitest run plugins/formats/tests/packs`. Real-tool fixtures: `sample.snap`,
`sample.squashfs` and `sample.wim` (mksquashfs and wimlib in a container, from
`plugins/archives/tests/make-fixtures-linux.sh`), LZO streams from liblzo2 (`tests/packs/make-lzo.py`)
and `tests/packs/make-fixtures.sh` (mksquashfs for every compressor and wimlib-imagex, in Docker).
The tests also write images of their own (`squashfs-builder.ts`, `wim-builder.ts`).
