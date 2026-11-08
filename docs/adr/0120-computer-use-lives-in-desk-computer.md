---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

# Computer use lives in desk-computer, and every act passes the caller's guard

## Context and Problem Statement

The person asked for Eris to operate every application on the Mac, with the OS permissions that
takes. That means seeing the screen (screenshots, the window list), reading and acting on other
apps' interfaces (the accessibility tree), synthesizing mouse and keyboard input, and launching,
activating, hiding and quitting apps, all under TCC grants the person gives in System Settings.
Where does the OS driver live, how do callers reach the acts, how is the person's computer protected
from an agent that acts too much or too fast, and who does macOS ask for the permissions?

## Decision Drivers

* The person decides: no act reaches the OS without passing a check the core supplies (ADR 0078)
* An emergency stop that ends input at once, and input that cannot flood the system
* One binding family and `unsafe` scoped to one module, as desk-sys does (`calendar/eventkit.rs`)
* Linux and Windows still build and test; a fake serves tests across the workspace
* Typing works in every script, Korean included, whatever keyboard layout is active
* Leave desk-sys alone: its manifest and root module belong to other in-flight work (#513)

## Considered Options

* A new crate `desk-computer`: a `Computer` trait, `Control` (guard, stop flag, rate limit), objc2
* A `computer` feature of desk-sys
* Existing crates: enigo (input), xcap (screenshots), an `accessibility` wrapper
* AppleScript and System Events through `osascript`
* A separate signed helper app holding the permissions

## Decision Outcome

Chosen option: "a new crate `desk-computer`", because computer use is large and macOS-specific,
needs its own permissions and safety rules, and one crate over the objc2 0.6 family (already in the
tree for desk-sys) keeps every binding and every `unsafe` block in one reviewed place.

* **Shape.** `Computer` is the platform: permissions, displays, windows, screenshots, focus, the AX
  tree (`tree`, `find`), apps, and the acts (`post`, `perform`, `set`, `launch`, `app`). `os()` is
  `MacOs`; elsewhere every call answers `unsupported`. `fake::FakeComputer` records calls and
  answers scripted screens and trees, and keeps the OS's permission rules.
* **Acts only through `Control`.** The acting methods take a `Permit` that only `Control` can make.
  `Control::act` plans the action (refusing what cannot run with `invalid_params`), asks the
  caller's `Guard` (there is no default: a caller passes `Verdict::Allow` explicitly), then runs one
  action at a time. Each event waits for the token bucket (`RateLimit`, 60 a second, 10 at once by
  default) and checks the `StopFlag` first. A raised flag aborts the running and queued actions at
  their next event with `cancelled` and refuses new ones until it is cleared; keys and buttons an
  aborted action held are released. The core's approval flow is the guard, under ADR 0078's rule.
* **Reading needs no guard**, only the OS permission: the core's grants decide who may read.
* **Elements are named by path.** An `ElementRef` is a pid, the child indexes (`AXChildren`) from
  the application element, and optionally the role it must still have, so a stale reference
  answers `not_found` instead of pressing something else. Walks are breadth first within a
  `Budget` of depth and nodes (at most 64 and 5000), and report what they cut. The walker and the
  finder are pure and shared by the OS and the fake.
* **Input.** CGEvent at the HID tap, each event marked `desk` in `kCGEventSourceUserData`. Text is
  `CGEventKeyboardSetUnicodeString` in chunks of at most 20 UTF-16 units cut on grapheme
  boundaries, so it bypasses the layout and the input method; line breaks and tabs are the Return
  and Tab keys. Chords use the US key codes, as shortcuts do.
* **Screenshots.** `SCScreenshotManager` on macOS 14 and later, `CGWindowListCreateImage` before
  it; drawn into an sRGB bitmap at the requested size and encoded as PNG in Rust.
* **Apps.** NSWorkspace launches by bundle id or `.app` path; quitting is `terminate`, never a
  force quit, so an app with unsaved work can still ask the person.
* **Who is asked.** TCC grants Accessibility and Screen Recording to the responsible process: the
  signed bundle `ai.endue.desk` in the app, the launching terminal under `just dev` or a test
  binary. `Permissions::bundle_id` says which. The crate opens the Privacy panes itself
  (`x-apple.systempreferences:`), because `shell.open` takes only http, https and mailto (ADR 0047).
  Screen Recording granted while the app runs takes effect at its next start.

### Consequences

* Good, because nothing acts on the person's apps around the core's guard, and one flag stops it all.
* Good, because the fake lets the core, the bridge and Eris's tools be tested on Linux CI.
* Good, because Korean and every other script type as written, with no layout switching.
* Bad, because only macOS works; Linux (AT-SPI, XTest or libei) and Windows (UI Automation,
  SendInput) need their own implementations later.
* Bad, because a path is only as good as the interface it was read from: a reordered list names
  another element unless the caller passes the expected role.
* Bad, because the macOS checks cannot run on CI: `tests/macos.rs` is ignored and run by hand.
* Bad, because the permissions belong to whatever process macOS holds responsible, so under
  `just dev` the person grants them to their terminal, which then has them for everything it runs.

## More Information

Issue #545; the bridge (`computer.*`), the core's grants and approvals, and Eris's tools are the
follow-up task. Code: `crates/desk-computer` (`src/control.rs`, `src/ax/walker.rs`, `src/input.rs`,
`src/macos/`). An event tap that stops Eris when the person moves the mouse would need Input
Monitoring and is not part of this decision.
