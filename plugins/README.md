# plugins

endue's built-in features, written as plugins in exactly the same folder format as community plugins. If
there were two formats, the API would have holes.

| Plugin | Role |
| --- | --- |
| `eris/` | The secretary (assets are under the `brand/` licence) |
| `sidebar/` | Left bar: agents and spaces |
| `toolbar/` | Right status panel: the drawer list (plugins, access) |
| `terminal/` | The person's shell in a PTY the core runs: several as tabs and desk buffers (`endue.terminal`, ADR 0037) |
| `onboarding/` | First-run scenario |
| `explorer/` | The folders the person allows as a tree (`endue.explorer`); files open through `desk.files` |
| `calendar/` | iCalendar (RFC 5545) files in month, week, day and agenda views (`endue.calendar`), with reminders and commands for agents |
| `mail/` | The person's mail from the index as threads in mailboxes, invitations read and answered (iTIP, iMIP), changes through the connector's commands (`endue.mail`) |
| `chat/` | Every chat service in one interface (`endue.chat`): Slack, Discord, Teams and any chat connector's messages by service and workspace, threads, reactions, replies, edits; four layouts (Conversation, Inbox, Timeline, Columns), changes through each connector's `chat.*` commands |
| `chat-digest/` | Chats at a glance (`endue.chat-digest`): a data-only `view` plugin, a page of universal views: unread counts, mentions, direct messages and the latest across every service |
| `projects/` | Project management over every task source (`endue.projects`): Jira, Linear, Asana and GitHub work read through adapters (ADR 0085) into Kanban, Swimlane, List, Database, Timeline and Calendar views; moves, dates, priority and assignee through the connectors' `task.move` and `task.update` |
| `views/` | The view engine (`desk.views`): opens any view by id, draws the deprecated item views (`specs/view/v0`) as surfaces over the core's `data.*` and `view.*`, and hands universal ones to `desk.universal` (ADR 0103) |
| `universal/` | Universal View (`desk.universal`): opens a universal view (`specs/view/v0/universal.schema.json`) of inline data, a file, a URL, another plugin's command or the index, as a timeline, calendar, board, list, text, chat, agent run, chart, stat or detail, or a page of them (ADR 0087, ADR 0103) |
| `fleet/` | The control center for agents (`desk.fleet`, ADR 0100): a data-only `policy` plugin whose command opens a universal kanban of every agent's runs, the ones waiting for approval first, with Approve, Deny and Stop |
| `island/` | The island's settings (`desk.island`, ADR 0204): a data-only `policy` plugin; `desk.island.show` puts the shell's island over every app |
| `today/` | The day at a glance (`desk.today`): a data-only `view` plugin, a page of universal views that `desk.universal` draws; `Mod+T` opens it |
| `github/` | Your GitHub work as tasks (`desk.github`): an http connector the core runs (ADR 0106), the issues assigned to you, the reviews you owe and your own pull requests; the token stays in the core |
| `pack-github/` | The GitHub pack (`desk.pack-github`, ADR 0108): data only, it brings `desk.github`, opens a board and a timeline of your GitHub work and switches to "Builder morning"; "Set up GitHub" to Eris applies it, Undo takes it back |
| `item/` | One item in Desk (`desk.item`): the data-only `view` plugin, a universal detail view, that the palette's Open in Desk shows |
| `inspector/` | What the desk holds now, read-only (`desk.inspector`, autoload): the render tree, surfaces and buffers, the last commands, grants, settings by layer, plugins, bridge calls; `desk inspect` prints its Export JSON |
| `memory/` | What Eris knows, kept on this computer (`endue.memory`, autoload): facts and conversations, search, edit a fact, forget one or everything (ADR 0095) |
| `agents/` | Every agent as a card (`endue.agents`, autoload, ADR 0112): your endue AI agents (`studio.*`) and the agent programs the core finds on this computer (`agents.*`) in one Home (cards with source and status chips and search, and the Activity board: Waiting, Active, Failed, Done), one Studio (the card's facets with an inspector beside it, Delete with the name typed) and New agent (find in the catalog, or build from scratch); a chat with a local agent whose reply streams, Stop, and its sessions' history |
| `computer/` | Eris uses your computer (`endue.computer`, autoload, ADR 0123): her tools to look, find, click, type, press keys and open and switch apps through `computer.*`, each act approved by the person and kept as a run with a screenshot; the Computer page with what macOS allows (Accessibility, Screen Recording), the apps she may operate, Stop and Resume; the banner the desk shows above every app while she acts |
| `screens/` | Screen Sharing (`endue.screens`, autoload, ADR 0133): another Mac's screen in a desk window over VNC, the protocol macOS Screen Sharing speaks; the kept computers, the macOS or VNC sign-in asked each time and never kept, View only and Fit; noVNC (vendored, MPL-2.0) over the core's `net.connect`, granted per computer |

The desk's default policies (ADR 0017), each a `desk.*` plugin. All but the palette are `policy` plugins:
no code, only what they contribute in `plugin.json`. Turn one off and another plugin can take its place.

| Plugin | Like (Emacs) | Decides |
| --- | --- | --- |
| `display/` (`desk.display`) | `window.el`, `display-buffer-alist` | Where a new surface goes, how big, whether it takes the focus |
| `palette/` (`desk.palette`) | `M-x`, the minibuffer | The command palette, picking one of many, run history, cancel (a UI plugin) |
| `buffers/` (`desk.buffers`) | `buffer.el`, `ibuffer` | The buffer list, switching, asking before closing unsaved work, what shows next |
| `files/` (`desk.files`) | `files.el`, `auto-mode-alist` | Which plugin opens a file, recent files, saving, changes on disk |
| `session/` (`desk.session`) | `desktop.el`, `savehist` | Putting the layout, open files, focus and history back at start |
| `market/` (`desk.market`) | `package.el`'s archives | Which market indexes Settings, Market lists beside the theme markets (`desk.market.indexes`, ADR 0107) |
| `notify/` (`desk.notify`) | the echo area, `*Messages*` | How long notifications stay by level, do not disturb, history |
| `theme/` (`desk.theme`) | `load-theme`, `defface` | Light or dark, following the OS, high contrast, reduced motion |
| `design/` (`desk.design`) | `defface` per widget | Which design system the components are made of (`desk.design.active`, ADR 0090) |
| `profiles/` (`desk.profiles`) | `init.el` | Profiles: a plugin set plus settings, switched and saved (formerly `modes/`) |
| `shell/` (`desk.shell`) | a frame's parameters | What a profile lays out in the shell (desktops 1–4), Eris's mesh and soul, the shell's colours, the sample profiles |

The base plugins a person works with from the first day (requirements, BASE):

| Plugin | Role |
| --- | --- |
| `notes/` (`endue.notes`) | Markdown and text files in a plain text area: the first file opener |
| `git/` (`endue.git`) | A keyboard-first front for Git: status, staging, commits, the log as a graph, diffs; every operation a command |
| `database/` (`endue.database`) | A client for PostgreSQL, MySQL / MariaDB and SQLite through their own command-line clients (ADR 0038): connections, an explorer, SQL consoles, exact results, guards for read-only and production connections |
| `docker/` (`endue.docker`) | Containers, Compose projects, images, volumes and networks: logs that follow, a container's detail, a shell, clean-up; every operation a command |

The agent programs a person already has, attached as a plugin (AG-09) and off until the person turns
it on (`autoload`: Claude and Codex are not on by default, ADR 0084):

| Plugin | Role |
| --- | --- |
| `local-agents/` (`endue.local-agents`) | Claude Code, Codex, Gemini CLI, Grok CLI, Qwen Code, Copilot CLI, Cursor Agent and OpenCode, found by their versions and asked through their non-interactive modes, read-only by default: the agents found, a chat with one, answers compared side by side, a kanban board of tasks they work through, the activity; every operation a command. The card Home of `agents/` shows the agents the core finds beside the endue ones (ADR 0112); this plugin stays for its compare, board and tools |

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
| `images/` (`endue.images`) | Every still image in one viewer with zoom, EXIF, the folder and compare: the web formats Chromium decodes (JPEG XL among them), its own uncompressed-RGB TIFF, TGA, Netpbm, QOI, DDS, HDR, EXR, ICNS, KTX, DICOM, FITS and NIfTI decoders, RAW previews; large files decoded in a worker with progress. HEIC and other TIFFs do not show in this build: they open as details with Show in Finder (ADR 0174) |
| `player/` (`endue.player`) | Video and audio files in one player with subtitles and playlists, streamed through `fs.url` (ADR 0041): what Chromium plays natively, Matroska, AVI, FLV, Ogg, MXF and MPEG-TS remuxed to MSE, the rest (AAC, WMV, Xvid, Theora, RealMedia, WMA, APE, ...) decoded by FFmpeg in WebAssembly (LGPL 2.1, ADR 0050); MIDI and AU played by the plugin. H.264 and HEVC video do not play in this build: they open as details with Show in Finder (ADR 0174) |
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

The built-in design systems: plugins of kind `design-system` (ADR 0090), named choices per component over
any theme, no code. `desk.design.active` names the one in force, set from the design system studio or
`desk.design.use`.

| Plugin | Role |
| --- | --- |
| `design-blueprint/` (`endue.design-blueprint`) | Blueprint: square corners, semibold caps on buttons, outlined actions, underlined fields and tabs, a brand bar on the active row |
| `design-soft/` (`endue.design-soft`) | Soft: pill buttons with a soft tint, filled fields, pill tabs, raised cards, solid badges |
| `design-compact/` (`endue.design-compact`) | Compact: small controls, tight padding, ghost buttons, dense rows and tables, thin rings |

Every plugin folder holds `plugin.json`, `README.md`, and as needed `ui/`, `logic/`, `tool/` and `tests/`
(a theme: `fonts/`, `images/` and `tests/`).

Status: `sidebar`, `eris`, `onboarding`, `toolbar`, `dock`, `terminal` and the ten `desk.*` policies work. With the
shell (`mountDesk`, ADR 0025), the agent bar, the rail and the bottom edge hold the places of `sidebar`,
`toolbar` and `dock`, and the shell's profiles turn those three off. The runtime puts `left`, `right` and
`bottom` surfaces on the desk's edges, as `desk.display` says. The first run still draws its own frame of
the toolbar, dock, profiles and left bar inside its overlay. The view engine `desk.views` draws six of the
ten view components over the core's item index; `calendar`, `kanban`, `chart` and `detail` come later.
`just dev` installs every folder here that has a `plugin.json` as a built-in plugin.

Settings, default keys and personal preference storage belong to the runtime core (ADR 0055),
not a plugin. Plugins can contribute additional bindings with `contributes.keys`.
