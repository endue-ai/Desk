# plugins/docs

`endue.docs` ("Docs"): every word-processor document in one page view, in the community folder
format and on the public SDK only. Word, Pages, OpenDocument, RTF, Hangul, AbiWord, WordPerfect and
Works files become one document model (`ui/model.js`) that one renderer draws. It reads; it does not
edit: `desk.files.save` is refused with "Docs opens files read-only."

| Formats | Read as |
| --- | --- |
| `.docx` `.docm` `.dotx` `.dotm`, `.odt` `.ott` `.fodt` `.sxw`, `.rtf`, `.hwpx`, `.abw` | Full: styles, lists, tables, images, links, headers, notes, comments |
| `.doc` `.dot`, `.hwp`, `.wpd`, `.wps` | Text only: paragraphs, headings and table cells |
| `.pages` | Its largest preview image · `.gdoc`: a card with the document's address |

The page view draws white pages at each section's paper size, breaking where the document breaks;
the outline lists headings 1 to 6; the comments panel highlights a comment's range; `Mod+F` and
`Mod+G` find; `Mod+=`, `Mod+-`, `Mod+0` and Fit width zoom. A damaged, encrypted or unknown file
opens as a details view: name, size, format and one sentence saying why.

It reads with `fs.read` as base64; the manifest declares no paths, so the first read of a folder asks
with `perm.request` for `<folder>/**`. `fs.watch` runs `desk.files.changed` when a file changes.

| Path | What lives there |
| --- | --- |
| `ui/docs.js` | The desk's requests, reads with one ask, watches (no DOM) |
| `ui/open.js` | Format from the first bytes, then the extension; the details on failure |
| `ui/zip.js`, `ui/cfb.js`, `ui/bytes.js`, `ui/xml.js` | Containers, deflate (DecompressionStream), XML |
| `ui/ooxml/`, `ui/odf/`, `ui/rtf/`, `ui/hwpx/`, `ui/abw/` | The full readers |
| `ui/doc/`, `ui/hwp/`, `ui/text/`, `ui/package.js` | Text-only readers, Pages and .gdoc |
| `ui/view/` | Pages, renderer, outline and comments, find, details |

```bash
pnpm exec vitest run plugins/docs
cargo run -p desk-cli -- plugin validate plugins/docs
plugins/docs/tests/fixtures/make.sh   # macOS + Docker: regenerate the real-tool fixtures
```
