# plugins/archives

`endue.archives`, every archive, package and disk image in one browser: the contents as a tree, a
preview of the selected entry, and extraction to a folder the person picks. It never changes the
archive. Community folder format, public SDK only, no third-party code. The decoders (Deflate and gzip
through `DecompressionStream`; bzip2, LZMA, LZMA2/xz, Zstandard, LZ4, LZW) and the 7z reader come from
the library `endue.formats` (`@endue-ai/formats/`, mapped in `ui/index.html`'s import map).

| Kind | Formats |
| --- | --- |
| Contents and extraction | ZIP and its family (jar, apk, ipa, whl, nupkg, appx, crx 2/3, ZIP64), tar (ustar, GNU, PAX) alone or in gzip, bzip2, xz, zstd, LZ4, single streams (.gz .bz2 .xz .lzma .zst .lz4 .Z), 7z, ISO 9660 (Joliet, Rock Ridge), deb, rpm, gem, xar and .pkg, cab |
| Contents only | RAR 4 and 5 (stored entries read), ARJ, LHA, MSI streams |
| Details only | DMG, raw disk images (MBR, GPT), VHD, VHDX, VMDK, QCOW2, WIM, SquashFS, Snap, AppImage, torrent |

Files are read in ranges (`fs.read` `offset`/`length`): a ZIP's or 7z's directory from the end, an
ISO's directories one by one, a tar's headers block by block, entries only when previewed or extracted.
The format comes from the first bytes, then the extension; what it cannot show opens as details.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`; `desk.files.save` is
refused. A read its grants do not cover asks once for the file's folder. Extraction asks with
`desk.palette.pick` for the folder, then `perm.request` for `fs:write` on it, and refuses names that
leave it (`..`, absolute paths, drive letters, links out); an existing file asks once for the run.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`, `desk.palette.pick`) | Report changes on disk; ask where to extract and what to do with existing files |

| File | Purpose |
| --- | --- |
| `ui/archives.js` | Requests, levels (archives inside archives), selection, previews |
| `ui/files.js`, `ui/source.js`, `ui/formats/` | Ranged reads and a block cache; one reader per format (`index.js` tells them apart), on the library's codecs and 7z reader |
| `ui/extract.js`, `ui/safety.js`, `ui/tree.js`, `ui/preview.js` | Extraction and the paths it refuses; sorting, filtering and previews, without the DOM |
| `ui/view*.js` | The DOM: a virtual ARIA tree, the preview pane, status and progress |

Keys: arrows, Page Up/Down, Home/End, Enter and Space (mark) in the tree, Mod+F filters, Escape stops an
extraction. `tests/make-fixtures.py` remakes the fixtures with the real tools (and the library's).
```bash
pnpm exec vitest run plugins/archives
cargo run -p desk-cli -- plugin validate plugins/archives
```
