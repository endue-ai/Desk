# plugins/archives

`endue.archives`, every archive, package and disk image in one browser: the contents as a tree, a
preview of the selected entry, and extraction to a folder the person picks. It never changes the
archive. Community folder format, public SDK only, no third-party code. The decoders and the 7z, RAR,
disk, Apple and pack readers come from the library `endue.formats` (`@endue-ai/formats/`, mapped in
`ui/index.html`'s import map); RAR, disk images, DMGs, SquashFS and WIM open in its worker
(`ui/library-worker.js`, the SDK's `startWorker`), or in the frame when none starts.

| Kind | Formats |
| --- | --- |
| Contents and extraction | ZIP and its family (jar, apk, ipa, whl, nupkg, appx, crx 2/3, ZIP64), tar (ustar, GNU, PAX) alone or in gzip, bzip2, xz, zstd, LZ4, single streams (.gz .bz2 .xz .lzma .zst .lz4 .Z), 7z, RAR 4 and 5 (solid too), ISO 9660 (Joliet, Rock Ridge), deb, rpm, gem, xar and .pkg, cab |
| Partitions and files | Raw disk images (MBR, GPT), VHD, VHDX, VMDK, QCOW2 with FAT, exFAT, ext and NTFS; DMG with HFS+ or APFS; SquashFS, Snap, AppImage; WIM. The image's details stay above the tree |
| Contents only | ARJ, LHA, MSI streams |
| Details only | torrent, and images whose volumes are not read (the note says why) |

Files are read through the SDK's `byteSource` (`fs.url` ranges, or ranged `fs.read`) with its block
cache: a ZIP's directory, a disk's tables, entries only when previewed or extracted. The format comes
from the first bytes, then the extension. Opening, long decodes and extraction show the desk's
`<desk-progress>` after 300 ms, with Cancel (Escape too).

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`, refuses `desk.files.save`,
and asks once for the file's folder when its grants do not cover a read. Extraction asks with
`desk.palette.pick` for the folder, then `perm.request` for `fs:write` on it, and refuses names that
leave it (`..`, absolute paths, drive letters, links out); an existing file asks once for the run;
files over 64 MiB are listed, not written (`fs.write` carries a file whole). Permission:
`cmd:invoke` for `desk.files.changed` and `desk.palette.pick`.

| File | Purpose |
| --- | --- |
| `ui/archives.js`, `opening.js`, `previews.js`, `jobs.js` | Requests, levels (archives inside archives), previews, long work as jobs |
| `ui/files.js`, `formats/`, `library-*.js`, `extract.js`, `safety.js`, `tree.js`, `preview.js` | File access, one reader per format (`index.js` tells them apart), the library worker, extraction and the paths it refuses, sorting and previews, without the DOM |
| `ui/view*.js` | The DOM: a virtual ARIA tree, the preview pane, status and progress |

Keys: arrows, Page Up/Down, Home/End, Enter and Space (mark) in the tree, Mod+F filters. Tests use the
library's fixtures; `tests/make-fixtures.py` remakes the plugin's own with the real tools.
```bash
pnpm exec vitest run plugins/archives
cargo run -p desk-cli -- plugin validate plugins/archives
```
