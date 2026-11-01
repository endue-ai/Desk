# plugins/docs

`endue.docs` ("Docs"): every word-processor document in one page view, in the community folder
format and on the public SDK only. Word, Pages, OpenDocument, RTF, Hangul, AbiWord, WordPerfect and
Works files become one document model (`ui/model.js`) that one renderer draws. It reads; it does not
edit: `desk.files.save` is refused with "Docs opens files read-only."

| Formats | Read as |
| --- | --- |
| `.docx` `.docm` `.dotx` `.dotm`, `.doc` `.dot` (Word 97-2003), `.odt` `.ott` `.fodt` `.sxw`, `.rtf`, `.hwp` (HWP 5.0), `.hwpx`, `.abw` | Full: styles, lists, tables, images, links, headers, notes, comments (Hangul's memos are not shown) |
| `.wpd`, `.wps` | Text only: paragraphs, headings and table cells |
| `.pages` | Its largest preview image · `.gdoc`: a card with the document's address |

The page view draws white pages at each section's paper size, breaking where the document breaks;
the outline lists headings 1 to 6; the comments panel highlights a comment's range; `Mod+F` and
`Mod+G` find; `Mod+=`, `Mod+-`, `Mod+0` and Fit width zoom. A damaged, encrypted or unknown file, a
Word 6 or 95 file or a Hangul distribution copy opens as a details view: name, size, format and why.

It reads with the SDK's `readBytes` in 2 MiB ranges (`fs.url`, or ranged `fs.read`); the manifest
declares no paths, so the first read of a folder asks with `perm.request` for `<folder>/**`.
`<desk-progress>` shows Reading, then Opening, after 300 ms; Cancel stops the read or the worker
and keeps what is on screen. Files over 8 MiB open in a worker (`ui/worker.js`, with its own XML
DOM). http, https and mailto links open with `shell.open` (the core asks once); note references
jump. `fs.watch` runs `desk.files.changed`. `ui/hwp/` follows Hancom's published format (`NOTICE`):
본 제품은 한글과컴퓨터의 글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

| Path | What lives there |
| --- | --- |
| `ui/docs.js`, `ui/worker.js` | The desk's requests, ranged reads with one ask, progress, watches (no DOM); the worker |
| `ui/open.js`, `ui/formats.js` | Format from the first bytes, then the extension; the details on failure |
| `ui/zip.js`, `ui/cfb.js`, `ui/bytes.js`, `ui/xml.js`, `ui/numbers.js` | Containers, deflate (DecompressionStream), XML, list numbers |
| `ui/ooxml/`, `ui/doc/`, `ui/odf/`, `ui/rtf/`, `ui/hwp/`, `ui/hwpx/`, `ui/abw/` | The full readers |
| `ui/text/`, `ui/package.js` | WordPerfect and Works text, Pages and .gdoc |
| `ui/view/` | Pages, renderer, outline and comments, find, links, progress, details |

```bash
pnpm exec vitest run plugins/docs
cargo run -p desk-cli -- plugin validate plugins/docs
plugins/docs/tests/fixtures/make.sh   # real-tool fixtures (macOS + Docker); also doc/make.sh, hwp/make.mjs
```
