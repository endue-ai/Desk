# plugins/sheets

`endue.sheets` opens every spreadsheet in one grid, read-only, in the community folder format and on
the public SDK only: Excel (`.xlsx .xlsm .xlsb .xls .xlt .xltx .xltm`), OpenDocument (`.ods .ots
.fods`), Numbers, CSV and TSV, DIF, SYLK, Lotus 1-2-3 and Quattro Pro, and Google Sheets shortcuts.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed` (`{ buffer, path }`);
`desk.files.save` is refused ("Sheets opens files read-only."). It reads with `fs.read` as base64, asks
once with `perm.request` for a folder its grants do not cover, and follows each file with `fs.watch`.

SheetJS Community Edition 0.20.3 parses, vendored in `ui/vendor` by `scripts/vendor-sheetjs.mjs`
(ADR 0043). The plugin reads OOXML cell styles and frozen panes and ODS sizes and panes itself.

| File | Purpose |
| --- | --- |
| `ui/sheets.js` | The desk's requests, fs calls with one ask on refusal, watches, the encoding setting |
| `ui/book.js`, `ui/detect.js` | Bytes to a book: the format from the first bytes, SheetJS, the details view |
| `ui/csv.js`, `ui/styles.js`, `ui/ods.js` | CSV encodings and delimiters; xl/styles.xml; ODS layout |
| `ui/model.js` | The sheet the grid draws: cells, text, formula bar content, sizes, merges |
| `ui/grid.js`, `ui/paint.js`, `ui/layout.js` | The virtual grid: only the cells on screen are in the DOM |
| `ui/selection.js`, `ui/keys.js`, `ui/find.js` | Selection, keys, count/sum/average, find |
| `ui/view.js`, `ui/main.js` | The page: name, formula bar, find, tabs, details view, status line |

Keys: arrows, Shift to extend, Mod+arrows to the edge of the data, Page Up/Down, Home/End, Mod+F
and Mod+G to find, Mod+= / Mod+- / Mod+0 to zoom. The desk's chords are never prevented.

| Setting | Default | Meaning |
| --- | --- | --- |
| `endue.sheets.csv-encoding` | `auto` | BOM, then UTF-8, then EUC-KR; or `utf-8`, `euc-kr`, `shift_jis`, `windows-1252` |

```bash
pnpm exec vitest run plugins/sheets
node --test scripts/vendor-sheetjs.test.mjs
cargo run -p desk-cli -- plugin validate plugins/sheets
sh plugins/sheets/tests/fixtures/make.sh   # rebuild the fixtures with LibreOffice (Docker)
```
