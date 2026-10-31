---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# Files open in one plugin per activity

## Context and Problem Statement

The desk's first goal is one application that can read every file a person has. There are
thousands of file extensions, from many vendors, and most people meet the same content in several
of them: a budget arrives as Excel, Numbers, a Google Sheets shortcut or a CSV. How are formats
grouped into plugins, what does "opens" promise for each format, and where does the parsing code
come from?

## Decision Drivers

* One interface per kind of content: a person reading a table should not learn three viewers
* Every file opens: a damaged or unsupported file still says what it is
* Plugin folders run as they are (ADR 0012): no build step, the frame's CSP (no eval, no network,
  no WebAssembly, no nested frames)
* The community format: built-in file plugins use only the public SDK, as a community plugin would
* Small, reviewable plugins that agents and people can work on in parallel (ADR 0015)

## Considered Options

* One plugin per activity (what a person does with the file), formats grouped under it
* One plugin per vendor or format family (an "Office" plugin, an "Apple iWork" plugin)
* One universal viewer plugin with a renderer per format
* Converting files in the core (or with system tools such as Quick Look) and showing the result

## Decision Outcome

Chosen option: "one plugin per activity", because the interface follows the content, not the
vendor, and each plugin stays small enough to finish.

The first nine:

| Plugin | Activity | Formats (examples) |
| --- | --- | --- |
| `endue.sheets` | read a table | xlsx, xls, numbers, ods, csv, tsv, Lotus, Quattro, gsheet |
| `endue.docs` | read a document | docx, doc, pages, odt, rtf, hwp, hwpx, gdoc |
| `endue.slides` | read a presentation | pptx, ppt, key, odp, gslides |
| `endue.reader` | read pages and books | pdf, xps, epub, mobi, azw3, fb2, cbz |
| `endue.images` | look at an image | png, jpeg, heic, webp, avif, RAW previews, exr, dicom, fits |
| `endue.player` | watch and listen | mp4, mov, mkv, mp3, flac, midi, subtitles, playlists |
| `endue.data` | inspect structured data | json, yaml, toml, xml, plist, env, hcl, cbor |
| `endue.archives` | look inside a container | zip, tar, 7z, iso, deb, rpm, pkg, dmg |
| `endue.web` | read a saved page | html, mhtml, webarchive, warc, url, lnk, rss |

Rules every file plugin follows:

* Read first, edit later. Each plugin answers `desk.files.visit`, `revert`, `buffers.show` and
  `closed`, and refuses `save` until its editor exists.
* Four tiers per format, said in the plugin's README and the surface: full (drawn as the author
  saw it), text only (the words without layout, for example Word 97 and HWP 5.0), preview (an
  image the file carries, for example Pages and Keynote), details (name, size, detected format and
  one sentence on why it is not drawn). Every file opens as at least its details.
* The format comes from the file's first bytes, then its extension. The desk's opener matches
  extensions case-insensitively when no rule matches as written (`IMG_0001.JPG`).
* No default file grants. The first file in a folder asks for that folder once (`perm.request`),
  as `endue.notes` does.
* File plugins autoload (ADR 0046): off at start, on when a file they claim opens, off again when
  their last buffer closes, so the desk holds no empty viewer windows.
* Own parsers by default. A library is vendored into the plugin folder (ADR 0037's pattern) only
  where writing one is unrealistic: pdf.js (ADR 0042) and SheetJS (ADR 0043). Never WebAssembly,
  which the frame's CSP forbids.
* Large files do not pass through the bridge whole: ranged reads and short-lived file URLs
  (ADR 0041) serve the player and the archive browser.
* Untrusted markup (web pages, e-books, feeds) is sanitized by an allowlist and drawn in a shadow
  root, never in the frame's own document as raw HTML (ADR 0044).

Extensions left out on purpose: `*.ts` (TypeScript far more often than MPEG transport streams;
`*.m2ts` and `*.mts` are claimed), `*.sub` (MicroDVD subtitles or VobSub images), `*.show`.

### Consequences

* Good, because a person meets one grid, one page view, one player, whatever produced the file.
* Good, because each plugin is a folder of its own: nine authors worked in parallel without
  touching each other's files.
* Good, because a community plugin can take over an activity, or add formats to it, by layering
  `contributes.files` rules.
* Bad, because some code repeats across plugins (a ZIP reader in five of them, a compound-file
  reader in three). Serving shared readers from the desk is a later decision, as ADR 0037 said of
  terminal emulators.
* Bad, because "details only" is still not reading: RAR, DjVu, video codecs WebKit lacks and disk
  image file systems wait for decoders.

## More Information

Next activities: code (source with highlighting and an outline), design files (psd, sketch, fig),
diagrams (drawio, vsdx, mermaid), 3D and CAD (gltf, stl, step, dwg), maps (geojson, gpx, kml),
fonts, contacts (vcf), logs and captures (log, har, pcap), certificates and keys (pem, p12),
scores (musicxml), datasets (parquet, arrow), notebooks (ipynb), and a binary viewer that opens
whatever no other plugin claims.

ADR 0012, ADR 0015, ADR 0029, ADR 0037, ADR 0041, ADR 0042, ADR 0043, ADR 0044, ADR 0046;
`plugins/README.md`.
