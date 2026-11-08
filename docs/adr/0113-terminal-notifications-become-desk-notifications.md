---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

# Terminal notifications become desk notifications, and a notice opens what it is about

## Context and Problem Statement

Programs in a terminal ask for the person's attention in several ways: iTerm2's OSC 9 message, rxvt's
OSC 777 `notify;title;body`, kitty's OSC 99, the bell, and, with shell integration (OSC 133, or VS
Code's 633), the end of a long command. Claude Code, build tools and test runners use them. Before this
change the terminal plugin turned only the bell into a desk notification ("Terminal: zsh rang the
bell."), and nothing a person could click on the desk led back to where a notice came from: the status
line showed text, and the notification history (`desk.notify.history`) ignored what was picked. The
person asked for every terminal notification to show in the desk. Which sources count, how a flood is
held back, and how a click on a notice reaches the tab it came from?

## Decision Drivers

* No spec change: `ui.notify` and `ui.notified` stay as they are; OS notifications are #521
* A program cannot flood the desk, however fast it writes
* What the person is looking at needs no notice; what they are not looking at does
* A click leads to the tab, not just to the plugin, for any plugin that wants that

## Considered Options

* The terminal maps every source to `ui.notify`, rate limited in the plugin; the runtime makes a running
  plugin's notice a button and opens a picked history entry, focusing the plugin
  (`desk.display.show`) and then sending it the desk request `desk.notify.open { notificationId }`
* The same mapping, with notification actions in `ui.notify` (a spec change: a notice names a command)
* The plugin guesses: when its frame takes the focus after a notice, it shows the tab that sent it

## Decision Outcome

Chosen option: "the terminal maps every source to `ui.notify`; the runtime opens a plugin's notice
through `desk.notify.open`".

* **Sources.** OSC 9 (ConEmu's numbered `9;N` commands are not messages; `9;9` is a folder), OSC 777
  `notify`, OSC 99 (chunks joined by `i` until `d=1`, `e=1` base64, `u=2` a warning, `o=unfocused` only
  when nobody looks, queries and buttons ignored), the bell from a tab nobody looks at (on the tab in view
  it flashes instead; `endue.terminal.bell: none` turns both off), a command that ran at least
  `endue.terminal.notify-after` seconds (10; 0 turns it off) on a tab nobody looks at, from OSC 133 or
  633 `C` to `D;exit`, and a program that ended with an error (a code other than 0, or a signal other than
  a hang-up) on a tab nobody looks at. `endue.terminal.program-notify` turns the programs' own off.
* **Looking.** The person looks at a tab when it is the one shown, the frame's page is visible and it
  has the focus.
* **Wording.** The title is `<tab title> — <program's title>`, or the tab's title alone; the body has its
  escape and control characters taken out, spaces folded, and is cut to 300 characters.
* **Flood.** Five a tab and ten a desk in any ten seconds; the same tab, title and body is said once in
  thirty. Those held back are counted, and the next one that goes out from that tab ends with
  `(and N more held back)`.
* **Unread.** A notice from a tab nobody looks at counts on that tab's badge until the person shows or
  focuses it.
* **The click.** A notice whose caller is a running plugin is a button in the status line (it reads as
  the line's text did); a click, or picking it in the notification history, runs
  `desk.display.show { plugin }` and then sends
  the plugin the desk request `desk.notify.open { notificationId }`, as the desk sends
  `desk.buffers.show` (ADR 0017). The terminal answers with the tab the notification came from, which it
  shows and focuses; a plugin without a handler answers `unknown_command`, which the runtime ignores. #521
  can send the same request when an OS notification is clicked.

### Consequences

* Good, because Claude Code's, a build's or a test run's notices reach the desk from a terminal in
  another window or desktop, and one click lands on the tab.
* Good, because any plugin can answer `desk.notify.open`, with no spec change and nothing to declare.
* Good, because a runaway program costs at most five notices every ten seconds, and the count of the
  rest is not lost.
* Bad, because `desk.notify.open` is a desk request that only ADR 0017's family documents; it is not in
  `specs/bridge`, like `desk.buffers.show` and `desk.files.visit`. Moving the desk's requests into a
  spec is a later change.
* Bad, because the long-command notice needs shell integration the person turns on (the terminal does
  not inject OSC 133, `docs/ko/terminal-requirements.md`).
* Bad, because a notice stays in the status line only as long as its level says (four seconds for
  info); the history keeps it.

## More Information

Plugin: `plugins/terminal/ui/{osc,notices}.js`, wired in `sessions.js` and `view.js`; tests
`plugins/terminal/tests/osc-notify.test.ts`. Runtime: `packages/runtime/src/policies/notify.ts`, tested
by `policies/notify-click.test.ts`. Requirements: TERM-E06 and TERM-N in
`docs/ko/terminal-requirements.md`. Builds on ADR 0017 and ADR 0061 (notice actions); #521 routes the same
notices to the OS.
