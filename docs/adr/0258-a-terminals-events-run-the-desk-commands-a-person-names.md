---
status: accepted
date: 2026-11-16
decision-makers: Team endue
---

# A terminal's events run the desk commands a person names, and programs copy with OSC 52

## Context and Problem Statement

ADR 0113 made every terminal notification a desk notification: OSC 9, 777 and 99, the bell, a long
command (OSC 133 / 633) and an error exit. A notification is something to read; the desk could do
nothing else with the event. The person asked that a terminal's alarms, events and bell can be run
inside the desk: Claude Code waiting for input, a build finishing or a bell should be able to bring
a tab forward, start a command or reach another plugin. The core's event bus does not help: its event
names are a closed list (`EventName` in `specs/plugin`), and a plugin cannot publish events of its own.

A plain modern terminal also lets programs copy text with OSC 52 (neovim, tmux, helix, programs over
ssh). The bridge has no clipboard permissions yet (BR-06), and TERM-I03 keeps the terminal off the
Clipboard API until it has.

## Decision Drivers

* No spec change: events and clipboard permissions are the maintainers' later decisions
* "Everything is a command" (promise 3): what the desk does is a command, from any caller
* A runaway program cannot flood the desk with runs any more than with notices
* A program may write the clipboard, never read it, and the person sees what it wrote

## Considered Options

* A setting `endue.terminal.event-commands` maps each event to a desk command id, run with
  `cmd.invoke` and what happened as its args
* A plugin-defined event on the core's bus (`events.publish`, names declared in the manifest)
* `ui.notified` opened to `events.subscribe`, so plugins hear every notification
* For OSC 52: the webview's copy (a copy event the terminal fills) or waiting for `clipboard:write`

## Decision Outcome

Chosen option: "the setting maps events to commands", and "OSC 52 through the webview's copy",
because both work on the bridge as it is and keep every action a command or a key's own copy.

* **Events.** `bell` (every bell), `notification` (OSC 9, 777, 99), `command` (one that ran at least
  `endue.terminal.notify-after` seconds) and `exit` (a program ending, whatever its code). Each runs
  whether or not the person looks and whatever `bell` and `program-notify` say; the args carry
  `{ event, session, tab, looking, level }` and the details (`title`, `body`; `commandLine`, `exit`,
  `seconds`; `code` or `signal`), and `held` when a flood held runs back.
* **Flood.** Five a tab and ten a desk in ten seconds, as notices (`flood.js`, shared).
* **Permission.** A command outside the plugin's `cmd:invoke` grant is asked for once with
  `perm.request`; a refusal or a failure is said once on the status line.
* **Hearing them elsewhere.** Every run is a `cmd.invoked` event on the core's bus, which a plugin
  with `events:subscribe` hears.
* **OSC 52.** Base64 text is copied through `document.execCommand("copy")` with a copy event the
  terminal fills; queries (`?`) are never answered; the status line says how many characters were
  copied; `endue.terminal.program-copy: false` turns it off. Chromium allows the copy only with a
  recent key or click, which a program copying for a person has; otherwise the status line says to
  select and copy.

### Consequences

* Good, because a bell or Claude Code's notice can show its tab (`endue.terminal.focus` takes the
  `session` it is given), start any command or reach another plugin, with no spec change.
* Good, because a flood costs at most five runs a tab every ten seconds, and the count is not lost.
* Bad, because a plugin cannot subscribe to the terminal's events without the person naming one of
  its commands; a real plugin event on the core's bus would need `specs/` and is a later decision.
* Bad, because the args are a contract of this plugin, not of `specs/`: renaming one breaks the
  commands people named.
* Bad, because an OSC 52 copy from a program nobody touched for seconds is refused by the webview;
  `clipboard:write` (BR-06) would lift that and replace the copy event.

## More Information

Plugin: `plugins/terminal/ui/{hooks,flood,clipboard,wire}.js`; tests
`plugins/terminal/tests/{event-commands,osc52}.test.ts` and the runtime e2e
`packages/runtime/e2e/terminal-render.spec.ts`. Requirements: TERM-N09 and TERM-I07 in
`docs/ko/terminal-requirements.md`. Builds on ADR 0113 (notifications) and ADR 0017 (commands).
Issue 319.
