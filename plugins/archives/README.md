# plugins/archives

`endue.archives`, every archive, package and disk image in one browser: the contents as a tree, a
preview of the selected entry, and extraction to a folder the person picks. It never changes the
archive. Community folder format, public SDK only, no third-party code. The decoders and most readers
come from the library `endue.formats` (`@endue-ai/formats/`, in `ui/index.html`'s import map); RAR,
disk images, DMGs, SquashFS and WIM open in its worker (the SDK's `startWorker`) or in the frame.

| Kind | Formats |
| --- | --- |
| Contents and extraction | ZIP and its family (jar, apk, ipa, whl, nupkg, appx, crx 2/3, ZIP64), tar (ustar, GNU, PAX) alone or in gzip, bzip2, xz, zstd, LZ4, single streams (.gz .bz2 .xz .lzma .zst .lz4 .Z), 7z, RAR 4 and 5 (solid too), ISO 9660 (Joliet, Rock Ridge), deb, rpm, gem, xar and .pkg, cab |
| Partitions and files | Raw disk images (MBR, GPT), VHD, VHDX, VMDK, QCOW2 with FAT, exFAT, ext and NTFS; DMG with HFS+ or APFS; SquashFS, Snap, AppImage; WIM. The image's details stay above the tree |
| Contents only | ARJ, LHA, MSI streams |
| Details only | torrent, and images whose volumes are not read (the note says why) |

Files are read through the SDK's `byteSource` and its block cache (a block at a time for 2 to 31,
#262); the format comes from the first bytes, then the extension. Long work shows `<desk-progress>`.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`, refuses `desk.files.save`,
and asks once for the file's folder when its grants do not cover a read. A window that sleeps keeps
each archive's levels, open folders, selection, marks, top row, sort and filter (`keepFiles`) and
comes back to them without asking; an archive the desk lists that it lost opens when shown. Extraction
asks with `desk.palette.pick` for the folder, then `perm.request` for `fs:write` on it, and refuses
names that leave it (`..`, absolute paths, drive letters, links out); an existing file asks once for
the run; files over 64 MiB are listed, not written. Permission: `cmd:invoke` for `desk.files.changed`
and `desk.palette.pick`.

| File | Purpose |
| --- | --- |
| `ui/archives.js`, `actions.js`, `keep.js`, `opening.js`, `previews.js`, `jobs.js` | Requests, what the person does, what a sleep keeps, levels (archives inside archives), previews, long work |
| `ui/files.js`, `formats/`, `library-*.js`, `extract.js`, `safety.js`, `tree.js`, `preview.js` | File access, one reader per format (`index.js` tells them apart), the library worker, extraction and the paths it refuses, sorting and previews, without the DOM |
| `ui/view*.js` | The DOM: a virtual ARIA tree, the preview pane, status and progress |

Keys: arrows, Page Up/Down, Home/End, Enter, Space (mark), Mod+F (filter), Escape (stop long work).
Tests use the library's fixtures; `tests/make-fixtures.py` remakes the plugin's own.
```bash
pnpm exec vitest run plugins/archives
cargo run -p desk-cli -- plugin validate plugins/archives
```
