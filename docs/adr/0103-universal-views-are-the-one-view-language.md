---
status: accepted
date: 2026-11-08
decision-makers: Team endue
---

# Universal views are the one view language; item views are read, never written

## Context and Problem Statement

ADR 0087 left the desk with two view languages: item views (ADR 0032), layouts of components over the
desk's index, and universal views, one presentation of entries from any source. ADR 0102 put both in
`~/.desk/views` and made Eris and the builder write universal views. Two languages mean two engines,
two ways to make the same board and two things for a market to carry (M3, ADR 0093). What item views
still do that universal views cannot: chart, stat and detail components, several components side by
side (Today, the chat digest), params, and clock templates in their queries.

## Decision Drivers

* One thing a person, Eris and the market make, store and share
* Every view that ships today (desk.today, endue.chat-digest, desk.item, the shell's samples) keeps
  showing the same data
* Files people already have keep working through v0 (ADR 0004)
* A universal view stays one presentation of one source: what made it simple to make from a sentence

## Considered Options

* Universal views gain what item views had: the missing presentations, params, clock templates, and
  a page that lays several out together
* Universal views gain a layout tree of their own (containers holding presentations)
* Keep both languages and convert between them

## Decision Outcome

Chosen option: "universal views gain what item views had", because a page of sections keeps each
section a plain universal view (one presentation, one source) while Today and the digest stay one file.

* **Presentations.** `chart` (the `value` role over time or per group as bars, a line or a
  sparkline; counts per group without a value), `stat` (the entries counted, their value summed, or
  the latest) and `detail` (one entry's fields). A new `value` role; options `chart` and `aggregate`.
* **Pages.** `UniversalPage`: a title, params, `columns` and `sections`, each a universal view
  without an id, params or provenance of its own. `view.*` carries it as a third `AnyView`; its
  summary has its number of sections.
* **Params and the clock.** A universal view or page declares `params` as item views did; an items
  source's `where` values read `{today}`, `{tomorrow}`, `{yesterday}`, `{now}` (in the view's zone)
  and `{params.<name>}`, filled by the SDK when the source loads.
* **Sources without requires.** A universal view has no `requires` and no source picker: an items
  query reads every source of its kinds the reader may read, or names a connector in `sources`
  (Today's GitHub section reads `desk.github`). `$name` sources stay an item view's.
* **View plugins.** A view plugin's `view` and `views` hold a `PluginView`: a universal view or page
  with its id, or an item view. The core lists and opens them as the person's files; desk.views hands
  a universal one, with its params, to desk.universal. desk.today and endue.chat-digest are pages,
  desk.item a detail view; the shell's calendar, tomorrow and notes samples are universal views
  with inline data drawn by `<desk-universal-view>`.
* **Item views.** `View` is described as deprecated: the core and desk.views read them through v0;
  nothing in the repository writes a new one (desk.propose has no item view kind, create-plugin's
  view template writes a universal view).

### Consequences

* Good, because a market view, Eris's proposal and a hand-built view are one format, drawn by one
  element.
* Good, because a page reuses everything a universal view has: each section loads under its own
  source's narrowest grant and switches its own presentation.
* Bad, because a page is a second shape in `AnyView` that readers narrow, beside the deprecated item
  view, until v1 drops item views.
* Bad, because a page's sections cannot reach each other: an item view's detail that followed the
  list's selection is now a detail of its own source.
* Bad, because nobody picks a source any more: Today shows every calendar's events and every task
  list's tasks, and a GitHub task due today is in Due as well as in GitHub.

## More Information

Issue #474. ADR 0032 (views are data), 0087 (universal views), 0102 (the views folder holds both),
0093 (the roadmap). `specs/view/v0/universal.schema.json` (`UniversalPage`, `UniversalParams`,
`UniversalAggregate`), `packages/ui/src/universal/figures.ts`, `packages/plugin-sdk/src/universal-clock.ts`.
