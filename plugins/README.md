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
| `sheets/` (`endue.sheets`) | Every spreadsheet in one grid with sheet tabs and a formula bar: Excel (xlsx, xls, xlsb), Numbers, OpenDocument, CSV and TSV (delimiter and encoding detected), DIF, SYLK, Lotus, Quattro, Google Sheets shortcuts; SheetJS vendored (ADR 0043) |
| `docs/` (`endue.docs`) | Every word-processor document as pages with an outline and comments: Word (docx, doc), OpenDocument, RTF, HWPX and HWP, AbiWord, WordPerfect and Works text, Pages previews, Google Docs shortcuts; one document model, its own readers |
| `slides/` (`endue.slides`) | Every presentation with a thumbnail rail, speaker notes and play mode: PowerPoint (pptx, ppt), OpenDocument, Keynote previews, Google Slides shortcuts; layouts, masters and themes resolved |
| `reader/` (`endue.reader`) | PDFs, e-books and comics with contents, search, bookmarks and notes: PDF (pdf.js vendored, ADR 0042), XPS, EPUB, MOBI and KF8, FB2, CBZ and CBT; CBR, CB7 and DjVu as details |
| `images/` (`endue.images`) | Every still image in one viewer with zoom, EXIF, the folder and compare: web formats, HEIC, JPEG XL and TIFF where WebKit decodes them, its own TGA, Netpbm, QOI, DDS, HDR, EXR, ICNS, KTX, DICOM, FITS and NIfTI decoders, RAW previews |
| `player/` (`endue.player`) | Every video and audio file in one player with subtitles and playlists, streamed through `fs.url` (ADR 0041); containers WebKit cannot play show their codecs; MIDI and AU played by the plugin |
| `data/` (`endue.data`) | Structured data and configuration as a tree and raw text with search, JSON Schema validation and masked secrets: JSON family, YAML, TOML, XML, property lists, INI, properties, dotenv, HCL, MessagePack, CBOR, BSON |
| `archives/` (`endue.archives`) | Every archive, package and disk image as a tree with previews and safe extraction: ZIP family, tar with gzip, bzip2, xz, zstd and LZ4, 7z, ISO, deb, rpm, gem, pkg, cab; RAR, MSI and disk images listed or described; ranged reads (ADR 0041) |
| `web/` (`endue.web`) | Saved pages drawn safely in a shadow root after an allowlist sanitizer (ADR 0044), MHTML, web archives, WARC and MAFF, link files (url, webloc, desktop, lnk) as cards, RSS, Atom and OPML; no script runs and nothing is fetched |

Every plugin folder holds `plugin.json`, `README.md`, and as needed `ui/`, `logic/`, `tool/` and `tests/`.

Status: `sidebar`, `eris`, `onboarding`, `toolbar`, `dock`, `terminal` and the nine `desk.*` policies work. With the
shell (`mountDesk`, ADR 0025), the agent bar, the rail and the bottom edge hold the places of `sidebar`,
`toolbar` and `dock`, and the shell's profiles turn those three off. The runtime puts `left`, `right` and
`bottom` surfaces on the desk's edges, as `desk.display` says. The first run still draws its own frame of
the toolbar, dock, profiles and left bar inside its overlay. The view engine `desk.views` draws six of the
ten view components over the core's item index; `calendar`, `kanban`, `chart` and `detail` come later.
`just dev` installs every folder here that has a `plugin.json` as a built-in plugin.

Settings, default keys and personal preference storage belong to the runtime core (ADR 0053),
not a plugin. Plugins can contribute additional bindings with `contributes.keys`.
