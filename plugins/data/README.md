# plugins/data

`endue.data` ("Data"), structured data and configuration files in one read-only surface, in the
community folder format on the public SDK only. Its `contributes.files` rules open JSON, JSONC,
JSON5, JSON Lines and NDJSON, YAML, TOML, XML, XSD and XSLT, property lists (XML and binary), INI,
CFG and CONF, Java properties, dotenv (`.env`, `.env.*`), HCL and Terraform, MessagePack, CBOR and BSON.

Every format is read by the plugin's own parser (`ui/parse/`, no third-party code) into one typed
tree whose nodes know their line and column. The tree and the raw text (a hex dump for binary
data) show side by side or one at a time; containers build their children when they open and
open in groups of 100, so a 50 MB JSON file opens. Search (`Mod+F`, `Mod+G`), the selected node's
JSON Pointer and path, parse errors at their line, and JSON Schema 2020-12 checks for JSON, YAML
and TOML: from the document's `$schema`, a `yaml-language-server` comment, a sibling
`<name>.schema.json`, or Validate with... (kept per file). Remote schemas are never fetched.
Secrets (every dotenv value, and values under keys like `password` or `api_key`) show as dots and
never reach the DOM until one is revealed; `endue.data.mask-secrets` turns the key rule off.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`, and refuses
`desk.files.save`. It reads with `fs.read` as base64 and, when its grants do not cover a file,
asks once for the file's folder. A file it cannot show opens as details with a sentence saying why.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`, `desk.palette.pick`) | Report changes on disk; pick a schema |

| File | Purpose |
| --- | --- |
| `ui/data.js`, `ui/schema-check.js` | The desk's requests, reads with one ask, watches, schema checks |
| `ui/formats.js`, `ui/parse/` | The format from the first bytes and the extension; one parser each |
| `ui/tree.js`, `ui/search.js`, `ui/secrets.js`, `ui/schema.js` | The typed tree, search, masking, JSON Schema |
| `ui/view.js`, `ui/tree-view.js`, `ui/raw-view.js`, `ui/panel.js` | The DOM: virtual tree and raw view, problems |

```bash
pnpm exec vitest run plugins/data/tests
node plugins/data/tests/make-fixtures.mjs /tmp/data-samples   # one sample file per format
cargo run -p desk-cli -- plugin validate plugins/data
```
