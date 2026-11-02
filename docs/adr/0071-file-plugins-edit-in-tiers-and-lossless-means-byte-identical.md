---
status: proposed
date: 2026-11-02
decision-makers: Team endue
---

# File plugins edit in tiers, and lossless means byte-identical

## Context and Problem Statement

ADR 0045 made file plugins read first and edit later, with four read tiers per format. Editing starts
now: `endue.sheets` edits CSV and TSV (#331), `endue.data` edits JSON, and YAML and TOML as text (#332).
A person who changes one cell of a CSV a colleague exported does not expect its line endings, quoting,
BOM or number spellings to change: version control shows every such byte as a change, and the next tool
may read the file differently. Some formats cannot be saved that way yet (YAML keeps comments and anchors
a plain parse loses) and some not at all (no xlsx writer). What does a plugin promise when it saves a
format, how does the person learn it before the first edit, and how is the promise tested?

## Decision Drivers

* A save changes what the person changed and nothing else, wherever a plugin can promise it
* The person knows what a save will do to this file before editing it
* One promise, tested the same way in every plugin, with failures that say where
* Plugins stay folders on the public SDK (ADR 0012, ADR 0045); no spec change before the desk needs one
* Three words a README and a label can carry

## Considered Options

* Three edit tiers per format (lossless, text, read-only), stated by the plugin, lossless proven by
  byte-level tests in the SDK
* Save every format through its parsed model and accept reformatting, as most editors do
* An edit tier field in the manifest's `contributes.files` rules
* Each plugin words and tests its own promise

## Decision Outcome

Chosen option: "three edit tiers, stated by the plugin, lossless proven by byte-level tests", because
it promises the most a format allows, tells the person before they edit, and costs no spec change.

| Edit tier | Promise | Save |
| --- | --- | --- |
| `lossless` | parse then serialize of an unchanged file is byte-identical, and an edit changes only the bytes it must | overwrites |
| `text` | the content survives, the formatting may not (comments, spacing, key order, anchors) | the first save of each file asks: "Save as copy" (the default) or "Overwrite" |
| `read-only` | nothing is saved | `desk.files.save` is refused, as ADR 0045 says |

* Every format a file plugin opens has an edit tier beside its read tier. The plugin's README lists
  them (formats with their read and edit tiers) and its surface shows the open file's tier before the
  first edit with `<desk-edit-tier tier format>` from `@endue-ai/ui`. A format with no stated tier is
  `read-only`, and so is a file that does not open at its format's full read tier.
* Lossless means byte-identical, not equivalent. `@endue-ai/plugin-sdk/testing` proves it:
  `assertRoundTrip(bytes, parse, serialize)` over fixtures that carry the format's corners (a BOM, CRLF
  and mixed line endings, no final newline, quoting, escapes, number spellings) and
  `assertMinimalEdit(before, after, edit)` for edits, where `edit` is the span (`{ offset, length }` or
  `{ find }`, optionally with the `bytes` it must become) and every other byte must stay. Both name the
  first differing byte with its line, column, hex and text, and list the changes (a capped Myers diff).
  They import nothing, so plain Node tests use them too.
* A format moves up a tier only with those tests. A plugin may promise less than it does, never more.
* The `text` tier's prompt is each plugin's own for now (#332 first); "Overwrite" is asked once per
  file. A shared prompt can follow when a second plugin needs it.
* No manifest field: the edit tier is the plugin's statement, as the read tier is. A field in
  `contributes.files` can follow when the desk itself must know a tier before the plugin loads.

### Consequences

* Good, because editing one CSV cell or one JSON value is a one-field diff, whatever wrote the file.
* Good, because every lossless claim is tested the same way, and a failure points at the byte.
* Good, because the person sees the tier before editing, and a text-tier save never overwrites a file
  silently the first time.
* Bad, because a lossless editor needs a concrete-syntax model (spans of the original bytes) per format,
  more code than parse and serialize; formats wait in `text` or `read-only` until they have one.
* Bad, because the tier lives in each plugin's README and code, not in data the desk can read.
* Bad, because a `text` format costs the person one choice on the first save of each file.

## Pros and Cons of the Options

* Saving through the parsed model is the least code, but every save of a hand-written file reformats it
  and the person learns that from the diff. It remains, said out loud, as the `text` tier.
* A manifest field would let the desk show tiers before a plugin loads, but it is a spec change for a
  value only the plugin acts on today.
* Each plugin on its own gives no shared words, label or test: "lossless" would mean something different
  in each README.

## More Information

Extends ADR 0045 (read first, edit later; the four read tiers). `packages/plugin-sdk/src/testing/round-trip.ts`
and its tests, `packages/ui/src/elements/edit-tier.ts` and its tests; the guide's "Editing files: edit
tiers" in `docs/plugins/authoring.md`. First users: #331 (`endue.sheets`: CSV and TSV lossless, the
Excel family read-only) and #332 (`endue.data`: JSON lossless, YAML and TOML text).
