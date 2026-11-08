# plugins/sheets

`endue.sheets` opens every spreadsheet in one grid, in the community folder format and on the public
SDK only, and edits CSV and TSV cells so that a save changes only their bytes (ADR 0071).

| Formats | Read tier | Edit tier |
| --- | --- | --- |
| `.csv .tsv` read as UTF-8 (a BOM or none) | Full | Lossless: delimiter, quoting, line endings, BOM, final newline and ragged rows kept |
| `.csv .tsv` in EUC-KR, Shift_JIS, Windows-1252 or UTF-16 | Full | Read-only: only UTF-8 is written |
| Excel (`.xlsx .xlsm .xlsb .xls .xlt .xltx .xltm`), OpenDocument (`.ods .ots .fods`), Numbers, DIF, SYLK, Lotus 1-2-3, Quattro Pro | Full | Read-only |
| `.gsheet` (Google Sheets shortcuts) | Details: the document's address | Read-only |

It answers `desk.files.visit`, `.save`, `.revert`, `desk.buffers.show` and `.closed` (`{ buffer, path }`),
reads binary ranges through SDK `readBytes` (bounded `fs.read` fallback), parses in a worker with
`desk-progress` after 300 ms (Cancel keeps the previous file) and follows each file with `fs.watch`. A
folder outside its grants is asked for once, to read or to save (`fs.write`, base64). The header shows the
tier (`<desk-edit-tier>`) and an unsaved mark; the first edit runs `desk.buffers.update { modified: true }`.
SheetJS Community Edition 0.20.3 parses (`ui/vendor`, ADR 0043); OOXML styles and panes, ODS sizes and
panes, and CSV syntax the plugin reads itself.

| File | Purpose |
| --- | --- |
| `ui/sheets.js`, `ui/save.js` | The desk's requests, fs calls with one ask, watches, edit tiers, saving |
| `ui/book.js`, `ui/detect.js`, `ui/csv.js` | Bytes to a book: the format, SheetJS, CSV encodings and delimiters |
| `ui/csv-syntax.js`, `ui/csv-edit.js` | CSV and TSV as their bytes (fields, line endings, BOM); edits over the grid |
| `ui/worker.js`, `ui/parse.js`, `ui/wire.js`, `ui/model.js` | Worker parsing, transfers, lazy cells; the sheet the grid draws |
| `ui/grid.js`, `ui/paint.js`, `ui/layout.js`, `ui/styles.js`, `ui/ods.js` | The virtual grid (only cells on screen); styles; ODS layout |
| `ui/view.js`, `ui/editor.js`, `ui/selection.js`, `ui/keys.js`, `ui/find.js` | The page, the formula bar's edits, selection, keys, sums, find |

Keys: arrows (Shift extends, Mod to the data's edge), Page Up/Down, Home/End, Mod+F, Mod+G, Mod+=/-/0; in
a lossless file F2, a double-click or typing edits in the formula bar (Enter, Tab, Escape). Chords pass.
Setting `endue.sheets.csv-encoding`: `auto` (BOM, UTF-8, then EUC-KR), `utf-8`, `euc-kr`, `shift_jis`, `windows-1252`.

```bash
pnpm exec vitest run plugins/sheets
node --test scripts/vendor-sheetjs.test.mjs
cargo run -p desk-cli -- plugin validate plugins/sheets
node plugins/sheets/tests/fixtures/make-csv.mjs   # the CSV and TSV fixtures (plain Node)
sh plugins/sheets/tests/fixtures/make.sh          # the others, with LibreOffice (Docker)
```
