# plugins

endue's built-in features, written as plugins in exactly the same folder format as community plugins. If
there were two formats, the API would have holes.

| Plugin | Role |
| --- | --- |
| `eris/` | The secretary (assets are under the `brand/` licence) |
| `sidebar/` | Left bar: agents and spaces |
| `toolbar/` | Right status panel: the drawer list (plugins, access) |
| `dock/` | Bottom dock: open and put away the plugins that open on the desk |
| `terminal/` | The person's shell in a PTY the core runs: several as tabs and desk buffers (`endue.terminal`, ADR 0037) |
| `onboarding/` | First-run scenario |
| `explorer/` | The folders the person allows as a tree (`endue.explorer`); files open through `desk.files` |
| `calendar/` | iCalendar (RFC 5545) files in month, week, day and agenda views (`endue.calendar`), with reminders and commands for agents |
| `mail/` | The person's mail from the index as threads in mailboxes, invitations read and answered (iTIP, iMIP), changes through the connector's commands (`endue.mail`) |
| `views/` | The view engine (`desk.views`): draws view files (`specs/view/v0`) as surfaces, over the core's `data.*` and `view.*` |
| `today/` | The day at a glance (`desk.today`): a data-only `view` plugin that `desk.views` draws; `Mod+T` opens it |
| `item/` | One item in Desk (`desk.item`): the data-only `view` plugin the palette's Open in Desk shows |

The desk's default policies (ADR 0017), each a `desk.*` plugin. All but the palette are `policy` plugins:
no code, only what they contribute in `plugin.json`. Turn one off and another plugin can take its place.

| Plugin | Like (Emacs) | Decides |
| --- | --- | --- |
| `display/` (`desk.display`) | `window.el`, `display-buffer-alist` | Where a new surface goes, how big, whether it takes the focus |
| `palette/` (`desk.palette`) | `M-x`, the minibuffer | The command palette, picking one of many, run history, cancel (a UI plugin) |
| `buffers/` (`desk.buffers`) | `buffer.el`, `ibuffer` | The buffer list, switching, asking before closing unsaved work, what shows next |
| `files/` (`desk.files`) | `files.el`, `auto-mode-alist` | Which plugin opens a file, recent files, saving, changes on disk |
| `session/` (`desk.session`) | `desktop.el`, `savehist` | Putting the layout, open files, focus and history back at start |
| `notify/` (`desk.notify`) | the echo area, `*Messages*` | How long notifications stay by level, do not disturb, history |
| `theme/` (`desk.theme`) | `load-theme`, `defface` | Light or dark, following the OS, high contrast, reduced motion |
| `profiles/` (`desk.profiles`) | `init.el` | Profiles: a plugin set plus settings, switched and saved (formerly `modes/`) |
| `shell/` (`desk.shell`) | a frame's parameters | What a profile lays out in the shell (desktops 1–4), Eris's mesh and soul, the shell's colours, the sample profiles |

The base plugins a person works with from the first day (requirements, BASE):

| Plugin | Role |
| --- | --- |
| `notes/` (`endue.notes`) | Markdown and text files in a plain text area: the first file opener |
| `git/` (`endue.git`) | A keyboard-first front for Git: status, staging, commits, the log as a graph, diffs; every operation a command |
| `database/` (`endue.database`) | A client for PostgreSQL, MySQL / MariaDB and SQLite through their own command-line clients (ADR 0038): connections, an explorer, SQL consoles, exact results, guards for read-only and production connections |
| `docker/` (`endue.docker`) | Containers, Compose projects, images, volumes and networks: logs that follow, a container's detail, a shell, clean-up; every operation a command |

The file plugins: one plugin per thing a person does with a file, every format of that kind in one
interface (ADR 0045). Each reads; none edits yet. Each autoloads: off at start, on when a file it
claims opens, off when its last buffer closes (ADR 0046). A file a plugin cannot draw opens as its
details (name, size, format, why).

| Plugin | Role |
| --- | --- |
| `sheets/` (`endue.sheets`) | Every spreadsheet in one grid with sheet tabs and a formula bar: Excel (xlsx, xls, xlsb), Numbers, OpenDocument, CSV and TSV (delimiter and encoding detected), DIF, SYLK, Lotus, Quattro, Google Sheets shortcuts; edits CSV and TSV cells losslessly, the rest read-only (ADR 0071); SheetJS vendored (ADR 0043); large workbooks read in ranges and parsed in a worker with progress |
| `docs/` (`endue.docs`) | Every word-processor document as pages with an outline and comments: Word (docx and, with its formatting, doc), OpenDocument, RTF, HWPX and HWP 5.0 with their formatting, AbiWord, WordPerfect and Works text, Pages previews, Google Docs shortcuts; one document model, its own readers; large files in a worker with progress, links through `shell.open` |
| `slides/` (`endue.slides`) | Every presentation with a thumbnail rail, speaker notes and play mode: PowerPoint (pptx, and ppt drawn from the binary format), OpenDocument, Keynote previews, Google Slides shortcuts; layouts, masters and themes resolved; large decks in a worker with progress, links and slide jumps |
| `reader/` (`endue.reader`) | PDFs, e-books and comics with contents, search, bookmarks and notes: PDF (pdf.js vendored, ADR 0042) read by range in a pdf.js worker, XPS, EPUB, MOBI and KF8, FB2, DjVu, CBZ, CBT, CB7 and CBR (DjVu, 7z and RAR through `endue.formats`); progress, links through `shell.open` |
| `images/` (`endue.images`) | Every still image in one viewer with zoom, EXIF, the folder and compare: web formats, HEIC, JPEG XL and TIFF where WebKit decodes them, its own TGA, Netpbm, QOI, DDS, HDR, EXR, ICNS, KTX, DICOM, FITS and NIfTI decoders, RAW previews; large files decoded in a worker with progress |
| `player/` (`endue.player`) | Every video and audio file in one player with subtitles and playlists, streamed through `fs.url` (ADR 0041): what WebKit plays natively, Matroska, AVI, FLV, Ogg, MXF and MPEG-TS remuxed to MSE, the rest (WMV, Xvid, Theora, RealMedia, WMA, APE, ...) decoded by FFmpeg in WebAssembly (LGPL 2.1, ADR 0050); MIDI and AU played by the plugin |
| `data/` (`endue.data`) | Structured data and configuration as a tree and raw text with search, JSON Schema validation and masked secrets: JSON family, YAML, TOML, XML, property lists, INI, properties, dotenv, HCL, MessagePack, CBOR, BSON; large files read in ranges and parsed in a worker with progress |
| `archives/` (`endue.archives`) | Every archive, package and disk image as a tree with previews and safe extraction: ZIP family, tar with gzip, bzip2, xz, zstd and LZ4, 7z, RAR 4 and 5, ISO, deb, rpm, gem, pkg, cab, and the files inside raw, VHD, VHDX, VMDK and QCOW2 disks (FAT, exFAT, ext, NTFS), DMGs (HFS+, APFS), Snaps, AppImages and WIMs, through `endue.formats`; ranged reads (ADR 0041), progress with Cancel; MSI, ARJ and LHA listed |
| `web/` (`endue.web`) | Saved pages drawn safely in a shadow root after an allowlist sanitizer (ADR 0044), MHTML, web archives, WARC and MAFF, link files (url, webloc, desktop, lnk) as cards, RSS, Atom and OPML; no script runs and nothing is fetched; external links open through `shell.open` (ADR 0047), large pages parsed in slices with progress |

The file plugins read large files in ranges and work off the main thread with the SDK's `readBytes`,
`byteSource` and `startWorker`, and show `<desk-progress>` from `@endue-ai/ui` with Cancel (ADR 0048).
Decoders that several plugins need live once, in a library plugin (kind `library`, ADR 0049): it runs
nothing itself, is never turned off, and its modules run in the importing plugin's frame under that
plugin's grants. Plugins import it as `@endue-ai/formats/<folder>/<file>.js` through an import map entry
`"@endue-ai/formats/": "/endue.formats/lib/"`; workers, which import maps do not reach, import it by URL.

| Plugin | Role |
| --- | --- |
| `formats/` (`endue.formats`) | Shared readers over a ranged `Source`, answering one `Archive` shape: `codecs` (deflate glue, bzip2, LZMA/xz, Zstandard, LZ4, LZW), `sevenzip`, `rar` (RAR 4 and 5, ADR 0051), `djvu` (pages, text, outline), `disk` (VHD, VHDX, VMDK, QCOW2, MBR, GPT, FAT, exFAT, ext, NTFS), `apple` (UDIF, HFS+, APFS, LZFSE), `packs` (SquashFS, AppImage, WIM); imported by `endue.archives` and `endue.reader` |

The built-in themes: plugins of kind `theme` (ADR 0056, ADR 0057), values and the font and image files
they name, no code. Installing one does not apply it: `desk.theme.active` names the one in force, set
from the theme studio, `desk.theme.use` or `desk theme apply`. `examples/plugin-hello-theme` is the
smallest; `docs/plugins/authoring.md` (Making a theme) says how to make one.

| Plugin | Role |
| --- | --- |
| `theme-paper/` (`endue.theme-paper`) | Paper & Ink: warm paper and ink-blue accents, Literata, a paper grain behind the windows, soft corners, calm motion |
| `theme-amber/` (`endue.theme-amber`) | Amber CRT: an amber phosphor terminal, IBM Plex Mono everywhere, scanlines, square corners, snappy motion |
| `theme-glass/` (`endue.theme-glass`) | Glass: translucent panes that blur an aurora behind them, round corners, deep shadows |
| `theme-fjord/` (`endue.theme-fjord`) | Fjord: cool northern blues, a gradient of deep water or mist, subtle corners, roomy controls |

Every plugin folder holds `plugin.json`, `README.md`, and as needed `ui/`, `logic/`, `tool/` and `tests/`
(a theme: `fonts/`, `images/` and `tests/`).

Status: `sidebar`, `eris`, `onboarding`, `toolbar`, `dock`, `terminal` and the nine `desk.*` policies work. With the
shell (`mountDesk`, ADR 0025), the agent bar, the rail and the bottom edge hold the places of `sidebar`,
`toolbar` and `dock`, and the shell's profiles turn those three off. The runtime puts `left`, `right` and
`bottom` surfaces on the desk's edges, as `desk.display` says. The first run still draws its own frame of
the toolbar, dock, profiles and left bar inside its overlay. The view engine `desk.views` draws six of the
ten view components over the core's item index; `calendar`, `kanban`, `chart` and `detail` come later.
`just dev` installs every folder here that has a `plugin.json` as a built-in plugin.

Settings, default keys and personal preference storage belong to the runtime core (ADR 0055),
not a plugin. Plugins can contribute additional bindings with `contributes.keys`.
