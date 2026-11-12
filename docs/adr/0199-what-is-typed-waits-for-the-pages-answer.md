---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0192 (the keys follow the window in use: a press on the page leaves them where the
page's focus rests).

# What is typed after a press on the page or a desk key waits for the page's answer

## Context and Problem Statement

The compositor routes every key to the surface with the focus the moment winit hands it over. Where
the focus goes after a press on the desk's page, or after a key the desk's keymap runs, is the
page's to say, and it says so later: the talk pill's click opens its line and focuses it, ⌘K opens
the palette and its place takes the page's focus. The page reported its focus after a `setTimeout`,
and the report crossed the bridge's lanes and the event loop: 50 to 140 ms after the press or the
key on a loaded machine. What was typed in between went to the window in use, here the Terminal,
whose shell got it. The app e2e "puts what is typed after a press on the talk pill in its line"
failed about one run in five (the spec typed 9 to 40 ms after the press), and a person typing
"zqx" 30 ms after ⌘K left `zq` at the shell prompt. Past the report, the palette's browser was
still hidden until the compositor drew it, and a hidden browser drops every key: letters were lost
mid-word. Who decides where a key typed before the page answered goes?

## Decision Drivers

* What is typed right after a press or a shortcut reaches what the press or the shortcut opened,
  in order, none lost and none doubled
* A shortcut that moves nothing (⌘S) and a press on a title bar keep the keys where they were, at
  once
* A page that never answers holds nothing for long
* No change to the surface protocol (`specs/`)

## Considered Options

* The compositor holds what is typed after a press on the page or a key the desk runs until the
  page answers it, and until the surface the answer gave the keys to is drawn
* The page reports sooner (a microtask instead of a timer), and nothing waits
* A press on a part of the system layer gives the page the keys at once, and the page gives them
  back when its focus rests

## Decision Outcome

Chosen option: "the compositor holds what is typed until the page answers", because only the page
knows what the press or the key did, and only waiting for it keeps the order winit gave. Reporting
sooner shortens the gap but does not close it (the report still crosses the bridge and the event
loop while winit's keys do not), and giving the page the keys at once misroutes the keys after a
press on a title bar the other way, into the talk line.

* **The router** (`crates/desk-compositor/src/input/hold.rs`): a press on the page, or a key the
  keymap runs (`KeyDecision::Run`), makes the keys, the modifiers and the OS input method's text
  typed next wait, in order. The page's answer sends them on to where the focus is then. An answer
  that gives them to a surface the compositor does not draw yet waits on until it is drawn. They go
  on anyway when the window loses the OS focus, when a drag starts, or 500 ms after the press, its
  release or the answer.
* **The page** (`apps/desk/src/compositor-focus.ts`): it reports a focus move at the end of the task
  that made it (a microtask), answers a press once its release is handled (after the click it
  made), and answers a key the desk ran by the focus move its command made, or once the command
  settled (`Keymap.onRun`, `packages/runtime/src/keymap.ts`). `compositor_focus` carries `answer`.
* **The shell** (`compositor_window/input.rs`): an answer first lets the keys follow the window in
  use the window manager names now, then sends on what waited.

### Consequences

* Good, because what a person types right after pressing the talk pill reaches its line, and what
  they type right after ⌘K reaches the palette's field whole, with nothing typed into the Terminal.
* Good, because the hold is one place for every press on the page and every desk key, so a new
  overlay or text line opened by either gets the same guarantee.
* Bad, because the keys typed after a press on the page or a desk key reach their surface a few
  milliseconds later (the page's answer), up to 500 ms if the page never answers or a command
  that moves nothing takes that long.
* Bad, because the page must answer every press on it and every key the desk runs: one more field
  on `compositor_focus`, which the page and the shell must agree on.

## More Information

Work order P2 of the QA pass #154 (the talk pill case of `e2e/specs/system-parts.spec.ts`, and the
palette case found with the live harness). Code: `crates/desk-compositor/src/input/{hold,router,
keys}.rs`, `apps/desk/shell/src/compositor_window/{input,commands}.rs`,
`apps/desk/src/{compositor-focus,desk}.ts`, `packages/runtime/src/keymap.ts`. Tests:
`crates/desk-compositor/tests/input_hold.rs`, `apps/desk/src/compositor-focus.test.ts`,
`packages/runtime/src/keymap.test.ts`, app e2e `e2e/specs/system-parts.spec.ts` (keys typed in the
same burst as the press on the pill) and `e2e/specs/keys-follow.spec.ts` (a word typed 10 ms apart
after ⌘K). `docs/architecture.md` does not describe the focus, so it does not change.
