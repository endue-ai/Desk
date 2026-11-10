# Accessibility in compositor mode

How screen readers see the desk as the compositor draws it (#57, ADR 0155; the only desk since ADR 0156),
what is checked automatically, what was seen on a real desk, and the manual screen-reader passes #61
runs on each OS. Stage 1's windowed desk is unchanged: CEF's windowed views give the OS each page's
tree there, as before.

## What the OS gets

One AccessKit tree on the compositor window (NSAccessibility on macOS, UI Automation on Windows,
AT-SPI on Linux), built only while an assistive technology is active:

- the window `endue Desk`, then:
  - `Desk`: the shell page's own tree (the bars, Eris, menus, the system layer);
  - `Windows`: a list, back to front; each window has its title bar (its title), the tools the page draws
    in its title bar (Split right, Split down, Floating mode, Pin, Put in drawer, Close: the page's
    buttons, pressed as the page's own), and its content: the plugin's tree, or the card the compositor
    draws (asleep, stopped, crashed, loading, not responding) with its buttons (Wait, Stop, Reload);
    a window of several panes has a group per pane;
  - the plugins the page lays out over the windows (the dock, edge bars), one group each.
- Boxes are where the compositor draws: a plugin's nodes go through its window's place in the scene.
- The focus is the focused node of the surface with the keys; the window with the keys is `selected`.
- Actions: a click, the focus, a value, increment and decrement, expand and collapse, scroll into view
  and the context menu reach the plugin's page as a person's input would; scrolling a node is a wheel
  over it; a title bar or a window is raised by a press on its title; a card's button runs its command.

## Checked automatically

| Check | What it proves | Command |
| --- | --- | --- |
| `crates/desk-compositor/tests/a11y_tree.rs` | Through AccessKit's consumer (which every adapter builds on, and which panics on an update it cannot take): the window list, title bars and a plugin's tree as one tree; boxes in the window's device pixels through where each surface is drawn; the focus where the keys are; a surface's change as that node alone; a window that goes and comes back; a moved window moving its plugin's boxes; a tree that lies about its children cut to what its root reaches; nothing out before activation, all of it when asked again; requests to surfaces and to the chrome; an asleep surface's last tree marked and inert | `cargo test -p desk-compositor --test a11y_tree` |
| `crates/desk-compositor/tests/a11y_properties.rs` | Random surface trees (missing, repeated and cyclic children, moving roots, focus anywhere) and random chrome (windows coming and going, moving, the keys moving, surfaces asleep or gone): every update the desk flushes is one the consumer takes, and its tree holds exactly what the desk wants; a fresh adapter given the whole tree holds the same | `cargo test -p desk-compositor --test a11y_properties` (`PROPTEST_CASES`, `PROPTEST_RNG_SEED`) |
| `src/a11y/{roles,surface_tests}.rs`, the shell's `web_host/a11y_{nodes,tree}_tests.rs`, `a11y_actions.rs`, `compositor_window/a11y_{chrome,check}.rs` | Roles and actions on the wire; Chromium's tree as CEF writes it (states, offset containers, scroll, transforms, text runs dropped, ignored nodes flattened, iframes stitched, a navigation replacing the tree) in logical pixels; actions as DevTools commands; a surface's place from the scene | `cargo test -p desk-compositor`, `just check-shell` |
| `apps/desk/shell/tests/a11y.rs` | On the built shell (the surface probe's `a11y` run): a page exports nothing until `a11y.enable`, then its heading, field, button, checkbox and a scrolled list with their roles, words and boxes at scale 2; a click reaches the button, the focus the field, a value is typed into it; the list's last item scrolled into view moves into the list; asleep and woken, the new browser exports again; turned off, it exports nothing and takes no action | `just build-shell`, then `just check-shell` (`DESK_SHELL_REQUIRE_PROBE=1` fails where it would skip) |
| `e2e/specs/a11y.spec.ts` | On the CEF desk in compositor mode with `e2e.a11y`: the tree the adapter has (`compositor_a11y`) holds the window list, the plugin's window with its title bar and the plugin's content, its boxes inside its window; a screen reader's click, focus and value reach the plugin, the keys follow the focus, and the tree's focus and value follow | `just build-shell && just test-app-e2e --spec e2e/specs/a11y.spec.ts` |

`compositor_a11y { activate?, deactivate?, act?: { role, label, action, value? } }` (development builds)
walks the tree the adapter has and does a screen reader's request on a node named by role and label.

## Seen on a real desk (macOS, 2026-11-10)

The default desk in compositor mode with `e2e.a11y` (`e2e/specs/a11y.spec.ts`'s start), the screen
locked, the desk's accessibility started by the check: fifteen windows, about 2,100 nodes, 253 of them
the page's. Every window had its title bar; twelve had their six title-bar tools, and the three whose
title bars lie under another window had none (the page's tools there cannot be pressed); each plugin's
content was inside its window at its place (Notes, Mail, Git, Chat, Docker's tabs, Explorer's tree and
toolbar). No screen reader ran: the
screen was locked, so what VoiceOver says and does is #61's below.

## Manual passes for #61

Run on the built desk (a fresh `HOME`) with the screen unlocked, on the shell and
three plugins: Notes, Git and Terminal. Record each step as passed, failed (what was heard or done) or
not possible, per OS, in the table under the steps.

VoiceOver (macOS; Cmd+F5, VO = Control+Option):

1. VO+Shift+Down into the window, VO+Right through it: `Desk`, then the window list `Windows, list` with
   its count, each window by title.
2. Into a window: its title bar reads the title; its tools read Split right … Close; VO+Space on Close
   closes the window.
3. Into Notes: its heading, fields and buttons in order; VO+Space on a button presses it; typing in a
   field after VO+Space types there; the VoiceOver cursor's box sits on the control in the window, also
   after moving the window and at another display scale.
4. Git: the status tree's items, expand and collapse with VO+\; Terminal: the terminal's text is read.
5. A sleeping window (twenty windows open): its card reads Asleep; a stopped one: Reload presses.
6. Trackpad commander or VO+mouse: touching a control reads it (hit testing follows the scene).

Narrator (Windows; Ctrl+Win+Enter): the same steps with Caps Lock+arrows, Caps Lock+Enter to press,
scan mode on and off. Orca (Linux, GNOME on Wayland and X11; Super+Alt+S): the same steps with Orca's
flat review and Enter to press.

| Step | VoiceOver | Narrator | Orca | Notes |
| --- | --- | --- | --- | --- |
| 1 window list | | | | |
| 2 title bar and tools | | | | |
| 3 plugin content, press, type, boxes | | | | |
| 4 tree items, terminal text | | | | |
| 5 cards | | | | |
| 6 hit testing | | | | |

## Gaps

- The page is one surface until #55: its tree holds the bars and menus and also what it draws of every
  window (each title a second time); only its title-bar buttons are placed in their windows.
- Protocol v0 has no text runs: in a field, character and word navigation and the caret read the value
  only; text selection, live regions (`aria-live`) and multi-selection are not mapped.
- Actions find their node through the browser's DevTools agent first (the full tree); a node in another
  frame's document is only pressed where its box is. Scroll offsets are read the same way after each
  location change (CEF 156 drops Chromium's scroll changes).
- The chrome's words (`endue Desk`, `Desk`, `Windows`) are English; the runtime's own words are the
  page's language.
- Only the desktop in front is in the tree; spread view and the minimap have no nodes yet.
- A native plugin (#59, ADR 0154) gets `a11y.enable` and `a11y.action` like a web surface, but its
  window holds only its title bar until the plugin answers with `a11y.update`; the example
  (`examples/plugin-native-wgpu`) does not yet.
- Windows and Linux are compiled against, not run (#61).
