# plugins/data

`endue.data` ("Data"), structured data and configuration files, each in a window of its own (ADR 0212),
in the community folder format on the public SDK only. Its `contributes.files` rules open JSON, JSONC, JSON5, JSON
Lines and NDJSON, YAML, TOML, XML, XSD and XSLT, property lists (XML and binary), INI, CFG and CONF,
Java properties, dotenv (`.env`, `.env.*`), HCL and Terraform, MessagePack, CBOR and BSON.

Each format has its own parser (`ui/parse/`, no third-party code) into one typed tree: tree and raw
text (hex for binary data), groups of 100, search (`Mod+F`, `Mod+G`), JSON Pointer and path, parse
errors at their line, JSON Schema 2020-12 checks for JSON, YAML and TOML (`$schema`, a
`yaml-language-server` comment, a sibling `<name>.schema.json` or Validate with...; never fetched).
Secrets (dotenv values, keys like `password`) show as dots and stay out of the DOM until revealed
(`endue.data.mask-secrets`). Reads are SDK ranges with progress and Cancel; above 1 MiB a worker keeps
the tree, text, search, checks and edits, and the page gets bounded, masked rows.

| Formats | Read tier | Edit tier (ADR 0071) |
| --- | --- | --- |
| JSON, JSONC (UTF-8, up to 64 MiB) | full | lossless: a save changes only the edited values' bytes |
| YAML, TOML (UTF-8, up to 64 MiB) | full | text: the first save asks "Save as copy" (default) or "Overwrite" |
| The other formats; files not UTF-8 or that do not parse | full, or details | read-only |

Enter or F2 on a value, or a double click, edits it in its row (`<desk-edit-tier>` shows the tier). It
answers `desk.files.visit`, `.save`, `.revert`, `desk.buffers.show` and `.closed`, asking once for a folder
to read or save. Asleep out of sight (ADR 0176), the SDK's `keepFiles` keeps its files, modes, open and
selected nodes and unsaved values. A narrow window first shows the tree alone; a small one folds its chrome.

| File | Purpose |
| --- | --- |
| `ui/data.js`, `wake.js`, `keep.js`, `schema-check.js`, `validate-with.js` | The desk's requests, reads with one ask, watches, sleep, schema checks |
| `ui/formats.js`, `ui/parse/`, `ui/tree.js`, `ui/search.js`, `ui/secrets.js`, `ui/schema.js` | The format (first bytes, then extension) and its parser; the tree, search, masking, JSON Schema |
| `ui/view.js`, `ui/places.js`, `ui/*-view.js`, `ui/panel.js`, `ui/worker*.js`, `ui/remote-*.js` | The DOM; the worker's document and bounded requests |
| `ui/edit/` | Tiers and edits (`session.js`), the JSON syntax model (`cst.js`), saving, the save question, the editor |

```bash
pnpm exec vitest run plugins/data/tests
node plugins/data/tests/make-fixtures.mjs /tmp/data-samples   # one sample file per format
node plugins/data/tests/large-fixtures.mjs /tmp/data-large    # 50 MiB JSON and 20 MiB YAML
node plugins/data/tests/edit-fixtures.mjs /tmp/data-edit      # edit-tier fixtures and a 10 MiB JSON
cargo run -p desk-cli -- plugin validate plugins/data
```
