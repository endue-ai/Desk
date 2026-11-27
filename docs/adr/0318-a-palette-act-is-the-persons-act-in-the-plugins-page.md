---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A palette act is the person's act in the plugin's page

## Context and Problem Statement

PG-109 (#504): Copy as, picked in the palette, never reached the clipboard. Each plugin page is an
off-screen browser of its own (ADR 0160, ADR 0201), and the palette runs the command from another
page, so the plugin's page has no key or press in it. Chromium lets a page write the clipboard only
while it has the focus and a transient activation (the five seconds after a key or a press in it),
and otherwise asks the embedder (`CEF_PERMISSION_TYPE_CLIPBOARD`). The shell had no handler, so
CEF left the question open: `navigator.clipboard` never settled, and the copy command fell back to a
textarea that Chromium also refused. When another window was in use, the page had no focus either.
How does a command the person runs in the palette write the clipboard, without letting a plugin write
it, or read it, on its own?

## Decision Drivers

* A plugin writes the clipboard only from a command the person started, never reads it without a paste
* No clipboard call left unanswered: refused at once, so the plugin can say so
* The keys stay where the compositor put them (ADR 0192)
* A plugin cannot claim to be the palette
* No new bridge method or spec for one plugin's feature

## Considered Options

* The shell refuses every clipboard question of a plugin page, and gives the page an activation (and
  the focus for its span, when it has none) when the palette runs one of its commands or answers its
  question
* Grant the clipboard question for plugin pages
* A core clipboard method (`clipboard.write`) the plugin calls with text and HTML
* The plugin shows its window (`desk.display.show`) before it copies

## Decision Outcome

Chosen option: "the shell refuses every clipboard question and gives the page an activation on a
palette act", because Chromium's own rule then holds for plugins as for any page, and the palette is
the one place a command is the person's own pick.

* `web_host/clipboard.rs`: a surface browser's permission handler answers a prompt holding the
  clipboard's type with DENY (a read, or a write without an activation); other prompts go on as before.
* The relay (`relay.rs`) reads each message it carries down to a surface: a `cmd.invoked` whose caller
  is a palette (`desk.palette`, the shell's `palette`) or a `cmd.answered` of `desk.palette.pick` that
  succeeded gives the surface's browser one activation, DevTools' `Runtime.evaluate` of `0` with a user
  gesture. Only the runtime's page posts down the relay, and the core names a command's caller from the
  page that called, so a plugin cannot make one up; an agent's, another plugin's or the CLI's command
  gives none.
* A surface the compositor gives no keys has its page's focus lent for those five seconds and taken
  back after, unless the compositor gave it the keys meanwhile (`input.rs` records whose they are).
  A lent focus gets no keys.
* The palette answers a pick even while the command that asked it runs (`plugins/palette`).
* In the plugin, a copy waits up to 1.5 s for its page's focus (the palette closing gives it back),
  then writes one `ClipboardItem` (TSV with an HTML table beside it, or the text alone), else the copy
  command with the text only.

### Consequences

* Good, because a copy from the palette or a press in the page reaches the clipboard on every platform,
  and every other clipboard call settles at once with NotAllowedError.
* Good, because no plugin can read the clipboard but through a paste, whose event carries its own text.
* Bad, because a palette pick gives the page five seconds in which it may write the clipboard more than
  once, as a press on its own button would.
* Bad, because the lend gives a page the focus for five seconds that the compositor did not: a page that
  draws its own focus ring may show it meanwhile.
* Bad, because the shell reads the relay's messages for two event names; a renamed event drops the
  activation (the unit tests and the app e2e `database-clipboard` pin them).
