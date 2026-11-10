---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# The desk is one AccessKit tree: the compositor's chrome, with each surface's tree grafted where it is drawn

## Context and Problem Statement

In compositor mode (ADR 0149–0153) the OS window is a wgpu scene and every web surface is a windowless
CEF browser, so no platform accessibility comes for free: WKWebView and CEF's windowed views gave each
frame's tree to the OS, an off-screen browser gives its tree only to the embedder
(`CefAccessibilityHandler`, `OnAccessibilityTreeChange` and `OnAccessibilityLocationChange`). The
surface protocol already says each surface exports a tree in AccessKit's `TreeUpdate` shape
(`specs/surface/v0/accessibility.md`, #49). How does the desk give VoiceOver, Narrator and Orca one tree
of its windows, its chrome and every plugin's content, with boxes on the right pixels and actions that
reach the surface, without the compositor knowing CEF and without a surface able to crash the desk?

## Decision Drivers

* One tree for the OS, in the order and at the places the compositor draws
* The compositor speaks the protocol only; Chromium's tree format stays in the shell's web host
* A surface's process is not trusted: nothing it sends may make the platform adapter panic
* Nothing is paid while no assistive technology runs
* Actions as a person's input would do them (`accessibility.md` § Actions)

## Considered Options

* AccessKit (`accesskit_winit`) with the chrome as the root tree and each surface's tree a subtree
  grafted where it is drawn
* AccessKit with every surface's nodes copied into one tree under ids of the compositor's
* Each OS's API by hand (NSAccessibility, UI Automation, AT-SPI)

## Decision Outcome

Chosen option: "AccessKit with grafted subtrees", because AccessKit already speaks all three APIs,
its subtrees (`TreeUpdate::tree_id`, a graft node's `tree_id`) take each surface's ids as they are, and a
graft's transform maps a whole surface to where it is drawn.

* **Adapter.** `accesskit_winit` on the compositor window (`compositor_window/a11y.rs`); the window is
  made unseen and shown once the adapter is on, as AccessKit asks. Its handlers reach the event loop
  through the pump. Activation (an assistive technology asks for the tree) turns the desk's
  accessibility on and every surface, the shell page included, gets `a11y.enable`; deactivation turns
  it off. Until then nothing exports.
* **The root tree** (`desk_compositor::a11y`, engine free) is built from `DeskChrome`, which the shell
  describes from what the last scene drew (`compositor_window/a11y_chrome.rs`): the page's tree (the
  system layer) as a group, then the window list, back to front; each window with its title bar, the
  tools the page draws in that title bar (the page's buttons there, standing in for them), and each
  pane's surface tree, or the card the compositor draws with its buttons; then the surfaces the page
  lays out over the windows. The root node's transform is the window's scale, so the chrome's nodes
  are in its logical pixels; a graft's transform is the surface's place in the scene (its node's world
  transform), so a surface's nodes stay in its own logical pixels through a moved, held or scaled
  window.
* **Surfaces' trees** are merged from `a11y.update` (`SurfaceTree`) and only what the root reaches goes
  out, each node once, with children that exist. `DeskA11y::flush` diffs every tree against what the
  adapter has and answers updates in an order the adapter takes: the root tree (its grafts) first,
  each subtree after (a new one whole), the focus into a subtree once that subtree is there. Two
  behaviours of `accesskit_consumer` 0.39.2 are worked around: an updated subtree root loses its link
  to its graft unless the update repeats its tree info, so it does; and moving a subtree's root in
  place can drop the new root, so a new root is a new subtree (`tree_of(surface, generation)`). A
  property test feeds random trees and chrome to the consumer and checks it never panics and holds
  the desk's tree.
* **The web host** turns CEF's events (Chromium's `AXTreeUpdate`s written as JSON) into the protocol
  (`web_host/a11y*.rs`): every frame's tree stitched at its iframe, boxes resolved through offset
  containers, scroll offsets and transforms and divided by the device scale, roles mapped to
  AccessKit's, ignored nodes made generic containers and text runs dropped, ids of its own stable while
  a node lives. CEF 156 drops Chromium's scroll changes, so after each location change the scrollable
  nodes' offsets are read through the browser's DevTools agent.
* **Actions.** Chromium has no action entry for an embedder and CEF's tree names no DOM node, so the
  web host finds the node through DevTools (`Accessibility.getFullAXTree` maps Blink's id to its
  `backendDOMNodeId`): a click scrolls it into view and presses its box with the mouse, focus is
  `DOM.focus`, a value is typed with `Input.insertText` over the selected text, increment and decrement
  are arrow keys. The compositor first gives the surface the keys and raises its window (its stand-in
  focused in the page, as a press does); scrolls are wheels over the node; the chrome's buttons are
  presses where they are drawn, so they run what a click runs (ADR 0153's cards).
* **Focus and selection.** The root tree's focus is the graft of the surface with the router's focus,
  so the screen reader's focus is that surface's focused node; a window is `selected` while it has the
  keys; a node's `selected` and `toggled` come from its surface.

### Consequences

* Good, because VoiceOver, Narrator and Orca each get one tree from one implementation, and a check
  can walk exactly what the adapter has (`compositor_a11y`, the consumer fed the same updates).
* Good, because the compositor stays engine free and a native plugin (#59, ADR 0154) is asked for
  its tree through the same protocol (its host passes `a11y.enable` and `a11y.action` to its
  process), and a surface's tree cannot crash the desk.
* Good, because an idle desk pays nothing: no surface serializes its tree until an assistive
  technology asks.
* Bad, because the page is still one surface until #55: its tree holds the bars and menus with what
  it draws of every window (titles a second time), and only its title-bar buttons are placed in their
  windows.
* Bad, because protocol v0 carries no text runs, so caret and character navigation in a field reads
  its value only; live regions and multi-selection are not mapped.
* Bad, because actions go through DevTools: each first finds the node in the full tree, and a node in
  another frame's document is only pressed where its box is.
* Bad, because only macOS ran it, without a screen reader (the screen is locked); Narrator, Orca and
  VoiceOver itself are #61's (`docs/qa/accessibility.md`).

## More Information

Issue #57 (epic #32 §2, §11). Builds on ADR 0141 (the protocol), ADR 0149 (off-screen surfaces), ADR
0150 (the router's focus), ADR 0151 (the hosted windows) and ADR 0153 (the cards' buttons). Code:
`crates/desk-compositor/src/a11y/`, `apps/desk/shell/src/compositor_window/a11y*.rs`,
`apps/desk/shell/src/web_host/a11y*.rs`. Tests: `crates/desk-compositor/tests/a11y_{tree,properties}.rs`,
`apps/desk/shell/tests/a11y.rs` (the probe's `a11y` run), `e2e/specs/a11y.spec.ts`. No section of
`docs/ko/desk-structure.md` changes.
