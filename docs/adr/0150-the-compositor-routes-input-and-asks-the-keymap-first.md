---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# The compositor routes input, asks the desk's keymap first and runs the drag broker

## Context and Problem Statement

In compositor mode (ADR 0140, 0149) the OS window is the compositor's and every plugin surface is an
off-screen browser, so no input reaches anything unless the compositor hands it on (`specs/surface/
v0/input.md`, `ime.md`). The window manager still lives in the shell page until #53, the keymap and its
precedence (ADR 0118) in the runtime, and ADR 0119's drag broker in the runtime too. Where does each
event go, who decides that a key is the desk's, and who runs a drag that crosses two surfaces' processes?

## Decision Drivers

* Every surface hears its input in its own logical pixels, through every transform, with a press's
  capture, the focus, the IME and the cursor as the spec says
* The desk's keys keep ADR 0118's precedence and pending prefixes, and work while a plugin has the focus
* Plugins, the SDK and the runtime unchanged; the security rules of ADR 0119 (a press behind every
  drag, types before items, a drop hands over paths not access) kept
* Engine free and testable without a window: winit and CEF stay in the shell

## Considered Options

* Route in `desk-compositor` (`input/`): hit test, keymap port and broker in Rust; the shell turns winit
  events in and protocol messages out
* Let the page keep routing: hand every event to the shell page and let its runtime forward it
* A separate `desk-input` crate

## Decision Outcome

Chosen option: "route in `desk-compositor`", because hit testing is already there (#50), and one router
owns the pointer, the focus, the IME and drags, so a drag or a prefix never splits across two owners.

* **Pointer**: the topmost surface quad under the pointer hears it in its own pixels; a press captures
  it until the last button goes up. The shell page (the underlay) also hears moves and presses over
  the plugin quads, at its own coordinates, so its window manager raises and drags windows as it did
  over frames; never wheels. Overlays the compositor draws take the pointer only while hit testing sees
  them; the focus ring and the drag image never do.
* **Keys**: to the focused surface. The runtime reports its keymap's entries, every layer's, with the
  commands registered; Rust resolves them by the same precedence (keymap.ts, sequences/ ported with
  their tests). While a prefix waits every key is the desk's; otherwise chords with Meta, Control or Alt
  are asked, the keys a frame forwarded in Stage 1. A key the desk takes never reaches the surface: the
  runtime hears it as that surface's `desk:key`. Plain keys and Escape go to the surface first, and the
  SDK still forwards what the plugin leaves.
* **Focus**: a press moves it; the runtime's own moves (a window it opens, Ctrl+Tab, the which-key
  overlay) come from the page, which says which stand-in has its focus.
* **Tab** (#123): the page's own focus order moves through its stand-ins as through frames. Tab enters
  a stand-in at a first edge (Shift+Tab at a last one), and the plugin's page focuses its first (or
  last) control, its text selected as Tab selects it; a page with none is passed by. A plugin's page
  that tabs past an end (CEF's `OnTakeFocus`) has its stand-in put the page's focus on that edge and
  Tab pressed in the page once more, so the focus goes on from the frame in the page's own order.
  Ctrl+Tab still focuses the window's section, the frame's place in that order, as the windowed desk
  did. The keys follow the page's focus, and AccessKit's follows the keys (ADR 0155). A stand-in is a
  frame of another process, which takes the focus after the page's element has let it go and with no
  focus event in the page: the page reports its focus on its window's blur too.
* **IME**: compositions and commits to the focused surface; the OS input method on only while that
  surface says an editable element has the focus; its composition's boxes place the candidate window.
* **Drag and drop**: ADR 0119's broker in Rust, on the protocol's `drag.*`; the web host turns the SDK's
  messages into them and back, ids and hover sequence numbers included. OS file drops arrive through
  winit and follow the OS pointer. A drag a page's engine starts (links, selections) joins the broker.

### Consequences

* Good, because typing, Korean composition, cursors and drags between plugins work in compositor mode,
  with the desk's keys first, and each rule is a CPU test (`tests/input_*.rs`, `tests/keymap*.rs`).
* Good, because #53 moves the window manager onto the same router: the underlay goes, nothing else.
* Bad, because the keymap's precedence exists twice until #83 deletes the runtime's copy; the runtime
  runs the command, Rust only decides whose the key is, and the two must resolve alike.
* Bad, because a bound chord a plugin used to handle first (Stage 1 let the plugin `preventDefault`) is
  now the desk's; a plugin claims a key through `contributes.keys`, by precedence.
* Bad, because a drag to another app (CEF's `StartDragging` handed to an OS drag session) is not done
  yet; drags stay inside the desk (#61 follows it per OS).

## More Information

Issue #56; epic #32 §2–§5. Code: `crates/desk-compositor/src/input/`, `apps/desk/shell/src/
compositor_window/{input,winit_input,harness,overlay,cursor,os_pointer}.rs`, `apps/desk/shell/src/
web_host/{input,key_codes,cursor,drag,routes}.rs`, `apps/desk/src/compositor-{keys,focus}.ts`. Tests:
`crates/desk-compositor/tests/{input_routing,input_ime,input_dnd,keymap,keymap_conflicts}.rs`,
`e2e/specs/{ime,dnd}.spec.ts`. Amends ADR 0118 (who decides first) and ADR 0119 (who runs the broker)
in compositor mode. `docs/ko/desk-structure.md` changes with #53, when the window manager moves.
Tab (#123): `apps/desk/shell/src/web_host/{stand_in.html,shim.js,relay.rs,client.rs,input.rs}` and
`apps/desk/src/compositor-focus.ts`, tested by `e2e/specs/a11y.spec.ts` and
`compositor-focus.test.ts`.
