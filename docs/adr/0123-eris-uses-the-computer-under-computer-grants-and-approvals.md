---
status: proposed
date: 2026-11-08
decision-makers: Team endue
---

# Eris uses the computer under computer grants, and every act of an agent waits for approval

## Context and Problem Statement

The person asked for Eris to operate every application on the Mac, with permissions they give.
desk-computer (ADR 0120) can see the screen and operate other apps behind a guard the caller
supplies. How does that reach the bridge and Eris's agentic loop (ADR 0089)? Who may see and who may
act, how is each act shown to the person and approved, how does the person stop it at once from any
app, and where can they review what was done?

## Decision Drivers

* The person decides every act an agent makes, and sees it while it happens (ADR 0078)
* Agents' grants are their own and capped by the person (ADR 0072); a plugin is no agent's deputy
* One way to stop everything, from any app, without an extra OS permission
* Reuse the approval card, the runs board (ADR 0100) and agent commands as tools (ADR 0088)
* Testable on Linux CI with the fake; nothing posts real input in a test

## Considered Options

* `computer.*` in the core under `computer:see` and `computer:control`, acts held on ADR 0078's card
* The plugin's commands marked `irreversible`, so `cmd.invoke`'s existing card holds them
* A computer-only approval channel (`computer.approval`) drawn by the plugin

## Decision Outcome

Chosen option: "`computer.*` in the core, acts held on ADR 0078's card", because only the core sees
the act and the app it reaches, and the card the person already answers can say both.

* **The namespace.** `computer.permissions.status|request|open`, `computer.screenshot`,
  `computer.windows`, `computer.apps.list` and `computer.ax.tree|find` read under `computer:see`;
  `computer.input.click|move|drag|scroll|type|keys`, `computer.ax.perform`,
  `computer.apps.launch|activate|quit` and `computer.stop` act under `computer:control`. The app
  injects the driver (`Core::with_computer`, `apps/desk/src-tauri/src/computer.rs`); without one, or
  off macOS, every call is `unsupported`. It needs no endue ID: it acts on this computer only.
* **Apps.** Both permissions take an optional `apps` list of bundle ids. Listings leave other apps
  out; an act reaches only the app under the pointer (mouse), the frontmost app (keyboard) or the app
  it names (`Target::App`). A display or region screenshot and launching by path need no list.
* **Whose act.** An `agent:<id>` caller's act is its own. A plugin's act that names an agent's
  invocation of one of the plugin's commands (`invocationId`) is that agent's too: capped by its
  allowlist, held as its call in its turn (`turn_of`), recorded on the invocation's run. Any other
  act is its caller's own. No agent operates the desk's own windows: they hold its cards.
* **Approval.** Every act of an agent waits for `perm.approval` (`action` the method, `target` the
  app, an `input` preview in words). "Allow for this task" lets the agent's later acts on the same
  app through until the turn ends (`task_scope` narrows `computer:control` to that app).
* **The core's guard.** desk-computer's `Control` runs behind a guard that lets an act through only
  from inside the core's checks, one at a time, rate-limited, under one stop flag.
* **Stop.** `computer.stop` raises the flag: running and queued acts end `cancelled`, new ones are
  refused until the person resumes (never an agent). While an agent acts the desk holds the stop key
  (Escape held half a second, or `endue.computer.stop-key`) and shows endue.computer's banner above
  every app and Space, without taking the focus, with Stop; `computer.activity` drives both.
* **Review.** Each act of an agent is a step on its run (`raw.computer.steps`, the body) with a
  screenshot of the main display after it, kept in `<data>/computer` (the newest 300); the run's
  deep link opens the latest.
* **Eris's tools.** `endue.computer` offers look, find, apps, click, type, keys, scroll, open and
  switch as agent commands, not marked `irreversible`: the core holds each act itself, so one card
  says what and where. The person's app list (`endue.computer.apps`) is the scope of every call.

### Consequences

* Good, because a prompt-injected agent can neither act unseen nor approve itself, and a person stops
  it from any app with one key.
* Good, because the card, the runs board, the allowlist and the perm log apply unchanged.
* Bad, because every act asks at first; "Allow for this task" per app is the relief.
* Bad, because while an agent acts Escape belongs to the desk: an agent dismisses a dialog with its
  Cancel button instead of the key.
* Bad, because the app an act reaches is read just before it runs; a window that moves in between
  can take a click meant for another app, which the person approved for the app the card named.
* Bad, because screenshots of the whole display may hold private things; they stay on this computer.

## More Information

Issue #548; desk-computer is #545 (ADR 0120); the floating Eris is #546 (ADR 0121). Code:
`crates/desk-core/src/core_computer.rs`, `crates/desk-core/src/computer/`, `plugins/computer/`,
`apps/desk/src-tauri/src/computer.rs`. Follow-ups: an AX `set` tool, Linux and Windows drivers.
