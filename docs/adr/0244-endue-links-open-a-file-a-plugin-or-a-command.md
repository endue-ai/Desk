---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

# endue:// links open a file, a plugin or a command, in a versioned grammar

## Context and Problem Statement

A link should open something in the desk from a browser, a chat or a terminal (#310, SYS-07 in
`docs/ko/desk-requirements.md`): a file, a plugin, a command. No scheme was registered anywhere. A
link outlives the desk that made it: one written today must mean the same thing, or be refused
plainly, in every later desk. Any web page can open a link, so a link must never do more than the
person would by hand. What grammar do links have, and what may each do?

## Decision Drivers

* A link means one thing forever, or is refused; a later desk can add kinds without breaking old ones
* A link from anywhere never runs something the person did not agree to, nor grants anything
* One parser, used by the shell and `desk open`, so the two never read a link differently
* The same hand-off as files: a running desk takes it, or a start does (`instance.rs`)

## Considered Options

* Host as the verb, no version: `endue://open?path=…`
* A version segment first: `endue://v1/open?path=…`
* The path in the URL's path: `endue://open/Users/a/b.md`

## Decision Outcome

Chosen option: "a version segment first", as the person chose on #310, because a later grammar can
change what a verb takes without guessing at an old link's meaning. Version `v1` is closed:

* `endue://v1/open?path=<percent-encoded absolute path>` opens a file or folder only after the
  person says yes, showing the path; then exactly as a double-click does (`desk.files.open`),
  granting nothing more. A link alone never grants a read: a double-click's folder grant follows the
  person's yes, not the link.
* `endue://v1/plugin/<plugin-id>[?surface=<surface-id>]` brings up a plugin that is on
  (`desk.plugins.open`); one the person turned off is refused with a notice, never turned on.
* `endue://v1/command/<command-id>` runs a command without arguments, only after the person says
  yes each time (`desk.palette.pick`).
* Every question offers "no" first, so a link that lands while the person types is not answered by
  their next Enter. A notice says why in the desk's words; it never repeats the link's text, and
  link text shown in a question loses control and bidi characters and is cut to 120 characters.
* `auth` and `install` are reserved for the login callback and install links, and refused until
  they exist. An unknown version, verb or query key, a repeated key, a fragment, a user or port, a
  relative or `..` path and a link over 8 KiB are refused whole with a notice; nothing is run.

The parser is `crates/desk-link`. macOS registers the scheme in `CFBundleURLTypes` and hands links
over through `application:openURLs:`; Windows (NSIS and MSI) and Linux (`x-scheme-handler/endue`,
`Exec=… %U`) hand them over as arguments. Windows registers `"…\endue-desk.exe" --single-argument
%1`, as Chrome and Edge do: everything after the switch is one argument, so a link holding `"` adds
no switch of its own (the class of CVE-2018-1000006); the shell reads the rest as one link or path. Windows also lists the macOS document types as "Open
with" entries under the ProgID `ai.endue.desk.file`, never an extension's default.

### Consequences

* Good, because an old link is read the same way by every desk, and a newer one is refused by name
  ("this link is for another version") instead of being half understood.
* Good, because no link grants a permission, changes a setting or runs a command unasked.
* Bad, because `?surface=` is parsed but `desk.plugins.open` opens the plugin's first window until
  it takes a surface.
* Bad, because the NSIS uninstaller does not remove the registrations its section wrote; a stale
  "Open with" entry points at a missing program until a reinstall or cleanup (follow-up).

## More Information

Issue #310; `crates/desk-link/README.md`; `apps/desk/src/open-links.ts`;
`apps/desk/shell/packager/windows/registrations.mjs`. Universal links over https are out of scope.
