---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0040 (closing a window unmounts its plugin for the session: what the plugin started in
the core goes on, and the plugin's next page hears it).

# A plugin put away for the session keeps hearing its work

## Context and Problem Statement

Closing a plugin's window by its × unmounts the plugin in the runtime for the session (ADR 0040),
and the runtime keeps the state the plugin saved (`desk:state`) for its next page. The core does
not hear of it: the plugin is still on, so its processes, watches, subscriptions and sockets go on
(`Core::unloaded` ends them only when the plugin is turned off or removed). But the runtime's
routing of the events those produce (`owners.ts`: `proc.output` and `proc.exit`, `fs.changed`,
`data.changed`, `net.*`, `brain.turn`, by the call that started them) forgot the plugin at the
unmount. The terminal showed it (#160, the QA pass of 2026-11-11, issue 06 #1): opened again, it
came back on its saved session and wrote to the same shell, which ran what was typed, while none
of the shell's output reached the page. The person typed blind into a live shell. What does a
plugin put away for the session keep?

## Decision Drivers

* A page never takes keys for a program whose answer it cannot show
* What the runtime keeps for a plugin (its state) and what the core keeps (its work) agree
* No new bridge method or event (`specs/` stays as it is)

## Considered Options

* Keep the routing while the plugin is put away; forget it when the plugin stops
* Forget the routing and end the work: the core ends a plugin's processes when its window closes
* Forget the routing and let each plugin start again: the terminal hangs up the shells it kept and
  starts new ones

## Decision Outcome

Chosen option: "Keep the routing while the plugin is put away", because the plugin, its saved
state and its work in the core all live on for the session already, and only the routing between
them was lost. The terminal's window comes back on the shells it had, their output following, as
it does after a reload (TERM-S07).

* `PluginHost` (`packages/runtime/src/plugins.ts`) no longer drops a plugin's owned keys when it
  unmounts; it drops them when the plugin is turned off or removed, when the core ends that work.
  An event for a plugin not mounted is still not delivered; a key still ends with its last event.
* Output while the window is closed is lost, as between a reload's two pages.
* A plugin that kept an id the core no longer has (the process ended while the window was closed)
  hears `not_found` from its next call: the terminal ends the tab (`sessions.js`, "zsh ended.").

### Consequences

* Good, because closing and opening a window loses nothing that was still running: a build, a
  server or a shell in the terminal; a watch or a subscription a plugin keeps an id of.
* Good, because the routing table no longer has to agree with the window manager.
* Bad, because a program in a closed terminal window runs on unseen until the window opens again
  or the desk quits; Terminal.app asks before it ends one, and the desk neither asks nor ends it.
* Bad, because a page that kept no id of work its previous page started is sent events it ignores.

## More Information

Issue #160 (draft 06 #1). Amends ADR 0040. Code: `packages/runtime/src/plugins.ts`,
`plugins/terminal/ui/{sessions,pipe}.js`. Tests: `packages/runtime/src/plugins.test.ts`,
`plugins/terminal/tests/order.test.ts`, `e2e/specs/terminal.spec.ts`. No section of
`docs/ko/desk-structure.md` changes.
