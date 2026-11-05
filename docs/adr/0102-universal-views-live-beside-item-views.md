---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Universal views are saved beside item views, and a sentence or the builder makes the same file

## Context and Problem Statement

Killer feature 1 of the roadmap (ADR 0093, M3) is "say it, see it": one sentence turns any source into
the view the person wants, and the person can build the same view by hand. Universal views (ADR 0087)
draw any source, but nothing could keep one: `view.*` (ADR 0036) knew item views only, so a
universal view lived in a plugin's own file or in a command's arguments. `desk.propose` (ADR 0073)
made item views only, which draw the desk's index and nothing else. Where does a universal view the
person keeps live, how does it come back, and what makes one?

## Decision Drivers

* One folder of the person's views, whatever language, so a view is a file they own and carry
* The core checks every view it writes against the spec, as it does item views (ADR 0036)
* Eris and the person make the same file; the shape can change later without touching the data
* The preview, Apply and Undo feel immediate: no blank wait, no redraw on Apply
* #474 makes universal views the one view language; this must not be a detour from it

## Considered Options

* `view.*` takes either language (`AnyView`), in `~/.desk/views/<id>.yaml`
* A folder of their own (`~/.desk/universal/`) through `fs.write` from the runtime
* New bridge methods (`universal.save`, `universal.list`)

## Decision Outcome

Chosen option: "`view.*` takes either language", because one folder and one set of methods is what
#474 needs anyway, and the core keeps checking what it writes.

* **The folder.** `~/.desk/views/<id>.yaml` holds an item view or a universal view. The core tells
  them apart by how they are written: a `layout` is an item view, a `type` or a `source` without one
  a universal view; each is checked against its own schema, and a universal view in the folder needs
  its `id`. `view.list` lists both; a universal view's line has its `type` and no `version`, and its
  id for a title when it has none. `view.get` and `view.save` carry `AnyView`.
* **From a sentence.** `desk.propose`'s `view` kind asks `propose_universal_view` with
  `UniversalView` bundled without `id` and `provenance`; the desk names it `eris.<slug>` and puts its
  `type` first in `types` (list, board, timeline and calendar when the brain named none). The item
  view kind stays as `item-view`, by name only, until #474. "show … as a board" (or on a calendar, in
  a document) joins make, build and show me on the talk line. brain-echo proposes one from the words.
* **Immediate.** A kind may show that it is drafting before the brain answers: `desk.universal`
  opens at once with what Eris is making and a ghost of rows. The preview draws the real source. On
  Apply the view stays drawn, element and data, while `view.save` writes the file, and the preview's
  bar turns into the notice with Undo.
* **By hand.** `desk.universal.build`: a source (a file, a URL, a command, the desk's items), a
  shape, the fields each role reads from with a live preview that loads the source once, a name;
  Save writes `my.<slug>` with `view.save`. `desk.universal.folder { path }` answers a folder as
  universal data, so "this folder as a timeline" has a source.

### Consequences

* Good, because a view Eris made and one built by hand are the same YAML in the same folder, opened
  by id from either (`desk.views.open` hands a universal id to `desk.universal`).
* Good, because the core still refuses what the schema refuses, for both languages.
* Bad, because `View | UniversalView` is a union every reader of `view.get` must narrow until #474.
* Bad, because the language is read from the keys, not named: a file with neither a layout, a type
  nor a source is reported against the item view schema.
* Bad, because the builder's preview is as good as the source's fields: free-form entries are drawn
  empty where a role is missing (ADR 0087).

## More Information

Issue #472. ADR 0036 (the core serves `view.*`), 0073 (Eris proposes desk data), 0087 (universal
views), 0090 (design system controls), 0093 (the roadmap). `specs/bridge/v0/view.schema.json`
(`AnyView`), `crates/desk-core/src/core_views_check.rs`, `packages/runtime/src/propose/universal.ts`,
`plugins/universal`, `examples/brain-echo/universal.mjs`.
