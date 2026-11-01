# lib/apple

Apple disk images and file systems, read only, in plain JavaScript over a `Source`
(`{ size, read(offset, length) }`): a DMG opens as the files inside it. No SDK, no DOM: it runs in
a plugin frame, a worker or Node. Written from TN1150, the Apple File System Reference, the public
UDIF layout and Apple's BSD-licensed LZFSE reference (`NOTICE`).

## API

```js
import { openApfs, openDmg, openHfs, openUdif } from "@endue-ai/formats/apple/index.js";

const dmg = await openDmg(source, { signal }); // the Archive of plugins/archives/ui/formats/archive.js
dmg.entries; // { path, kind, size, date, method?, packed?, link?, refusal? }; "<volume>/<path>" when several
await dmg.read(entry, limit, { signal }); // one file's bytes (its first `limit` bytes)
const { format, details, disk } = await openUdif(source); // the disk inside, as a Source
await openHfs(volume); // a bare HFS+ or HFSX volume; openApfs(container) a bare APFS container
```

- UDIF: the `koly` trailer, the XML list's (or an old resource fork's) `blkx` tables, chunks that
  are zero, raw, ignored, ADC, zlib, bzip2, LZFSE or LZMA (UDRO, UDCO, UDZO, UDBZ, ULFO, ULMO);
  the Apple Partition Map, GPT and MBR (`../disk/partitions.js`); a file with no trailer is a raw
  disk. Encrypted, sparse and split images are refused with a sentence.
- HFS+ and HFSX: catalog, extents overflow, attributes, hard links (files and folders), symlinks.
- APFS: the latest valid checkpoint, object maps, each volume's tree; encrypted volumes are named
  and not read, Fusion containers refused, snapshots counted.
- decmpfs files on both: zlib, LZVN, LZFSE and stored, in the attribute or the resource fork;
  LZBITMAP is named and not read. FAT, exFAT, NTFS and ext volumes go through `../disk/`.

Chunks are decoded when a read first touches them (64 MiB kept); only the tables, folders and files
asked for are read. Long work yields every 25 ms and stops with an `AbortError` when `signal`
fires; damage rejects with a sentence. The HFS+ journal is not replayed.

## Tests

`pnpm exec vitest run plugins/formats/tests/apple`. The fixtures come from
`tests/apple/make-fixtures.py` (hdiutil, diskutil, ditto and libcompression on macOS).
