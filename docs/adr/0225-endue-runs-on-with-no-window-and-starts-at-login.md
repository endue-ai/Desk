---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Carries out the resident hub of ADR 0205 (kept from ADR 0203). Amends ADR 0204 (the island quits
endue).

# endue runs on with no window, and starts at login

## Context and Problem Statement

The desk is endue's screen, and the island shows over other apps while the desk is not in front (ADR
0205, ADR 0204). An agent given a run does not need the desk's window, and a person who closes it
expects the run to finish and to hear of it. On `main` closing the window already hid it and the
process stayed, but the runtime's page, which routes every command, every plugin's call and every
notice, stopped working well once hidden. Chromium lets a hidden page's timers run once a second, and
once a minute after five minutes; it lowers a hidden page's renderer priority; and it sends a hidden
page no animation frame, so whatever waited for one (`realClock`: a tween, a notice's time, a key
sequence's wait) never ended. The shell learned that its window went from the OS, which says nothing
of a window that never showed or of a locked screen. Nothing started endue at login: `desk-sys` had
the login items (a LaunchAgent on macOS, the Run key on Windows, an XDG autostart entry on Linux)
and no crate turned them on. And Quit sat in the menu bar and the tray only: the menu bar is the
front app's, so with every window closed the tray was the one way out.

What keeps the hidden page working, how does endue start at login without a window, and what may it
cost at rest?

## Decision Drivers

* A run an agent was given finishes with every window closed, and its notice reaches the island
* What the shell tells the desk's page (a quit, files opened, a crash, the live windows) is acted
  on while the page is hidden
* A start at login shows nothing: no window, and no app taken out of the person's hands
* A development build never changes the person's login items
* Costs at rest are measured and gated, with no threshold a measurement does not carry

## Considered Options

* Keep the desk's page "shown" to Chromium while its window is hidden
* Tell Chromium the page is hidden, and turn off its throttling of hidden pages for every page
* Move the routing out of the page into the core

## Decision Outcome

Chosen option: "tell Chromium the page is hidden, and turn off its throttling", because a hidden
page paints nothing and costs no frame, the page itself knows it is hidden (`document.hidden`) and
can run its frames on timers, and a plugin's hidden page, where an agent's run may be working, keeps
its pace too. Keeping the page "shown" would have kept it painting to nobody or left it without
frames and without knowing why. Moving the routing into the core is the larger change ADR 0093
points at, and not this step.

* **Hidden pages keep their pace** (`apps/desk/shell/src/resident.rs`). The browser process gets
  `--disable-background-timer-throttling` and `--disable-renderer-backgrounding`. Both are for the
  whole process: Chromium has no such switch for one page. The live budget (ADR 0142) still puts
  plugins' pages out of sight to sleep after `desk.display.unload-after`.
* **Frames on timers while hidden** (`packages/runtime/src/clock.ts`). `realClock` asks for an
  animation frame while the page shows and sets a timer 50 ms on while it is hidden; a frame still
  out when the page goes out of sight moves to a timer. 50 ms, not 16: nobody sees the steps, a
  tween still ends on time, and a ticker that runs while something moves wakes 20 times a second
  instead of 60.
* **The shell says the window went** (`Shell::main_seen`). Hiding the main window (its red button)
  and showing it again from hidden (the Dock, the tray, the island, a second start, a quit that
  must ask) tell the compositor and the page at once. The OS's own word still comes and changes
  nothing more; of a window that was minimized or behind others the OS alone says when it shows,
  as before.
* **What the shell tells the page works hidden.** `emit(Role::Main, …)` is a message to the page's
  frame, which a hidden page takes; with timers and frames at their pace the page acts on it. A
  quit asks the hidden page about unsaved changes as before, and when the page must ask the person
  the desk comes forward (`quit.rs`, `Step::Show`). Files opened with the desk bring it forward,
  and so do files dropped on a window out of the desk while the desk is hidden, since their
  windows open there.
* **Quit is the menu's, the tray's or the island's.** The open island has "Quit endue"
  (`island_quit`), which asks the page as the menu's Quit does. A desk that quits opens no window:
  the island's own rule (show while the desk is not in front) ran again as the closing windows
  lost the keys, opened a new island whose browser nothing closed, and the desk never ended, in
  about one quit in four with the island open.
* **Start at login** is `desk.login.start` (`plugins/login`, off by default). The desk's page tells
  the shell what the setting is once the desk is ready and when it changes (`desk_login`,
  `apps/desk/src/login.ts`): the settings window keeps a person's choice in the runtime's store,
  which the core's `settings.get` does not read. The shell makes the login item match
  (`apps/desk/shell/src/login.rs` on `desk_sys::login`): the item starts the desk with
  `--background`, which opens the main window hidden, does not activate the app, and leaves the
  island, the tray and the shortcuts as the ways in. A second start by the login item changes
  nothing of a desk that runs.
* **A development build writes no login item of the person's.** It would register a program in a
  build folder. It writes a LaunchAgent only in the folder `DESK_LOGIN_ITEMS` names, which the app
  e2e sets under each spec's own HOME.
* **Budgets at rest with no window** (`e2e/perf/resident.perf.ts`, `residentAtRest` in
  `e2e/perf/budgets.json`): the Default profile, the window closed, twenty seconds alone and thirty
  measured. See More Information for what was read and how the budgets follow from it.

### Consequences

* Good, because the page that routes endue's work keeps working with every window closed
* Good, because a start at login takes nothing from the person: no window, no activation
* Good, because the same gate that reads a desk in sight and out of sight now reads the resident
* Bad, because every hidden page keeps its timers' pace, a plugin's too: a plugin that polls on a
  short timer costs while hidden what it costs in sight, until the live budget puts it to sleep
* Bad, because the page tells the shell the setting, so a desk whose page never gets ready leaves
  the login item as it was
* Bad, because a LaunchAgent names the program's path: an app moved to another folder starts at
  login again only once it has run from there
* Bad, because the routing still lives in a page: the resident needs a renderer and a GPU process
  for a page nobody sees

## More Information

Issue #237, part of #232. Not exercised: a real logout and login. What writes and removes the agent
is tested against a temp HOME (`apps/desk/shell/src/login.rs`, `crates/desk-sys/tests/login.rs`),
and the app e2e starts the desk with `--background` and reads the agent the setting wrote under the
spec's HOME (`e2e/specs/resident.spec.ts`); launchd loading that file at a login was not run.

Measured on 2026-11-15 on the reference machine (darwin-arm64), a debug build with chromedriver
attached, while other agents built and tested on it. `e2e/perf/resident.perf.ts`, four runs at a load
average of 5 to 28:

| | Run 1 | Run 2 | Run 3 | Run 4 | Budget |
| --- | --- | --- | --- | --- | --- |
| The app's own process, % of a core | 0.8 | 0.5 | 1.1 | 0.5 | 2 |
| Its whole tree, % of a core | 3.4 | 2.2 | 3.6 | 1.9 | 6 |
| The tree's RSS, MB (29 processes) | 3,555 | 3,570 | 3,547 | 3,585 | 4,000 |

#237 asks for under 1 % of a core. Three runs of four read under it and one read 1.1 %, on a busy
machine, so 1 % is kept beside the values as the target (`targetPercent`) and the gate is 2 %, about
twice the slowest reading; a quiet runner's readings decide whether it comes down to 1. The tree's
budget is the slowest reading and two thirds more. The memory budget is the largest reading and about
a tenth more: it is the Default profile's thirteen plugin windows, their pages still live fifty
seconds after the window closed (the live budget puts them to sleep after 300 s, which the run does
not wait for), and `idleMemory`, the same desk with its window in sight, read 3,603 MB the same hour.

The same hour `e2e/perf/hidden.perf.ts` read, with the window closed for 13 s: the app's own process
0.9 to 1.9 % (1.4 % on a build of the commit this branch starts from) and its tree 7.5 to 13 % (3.5 %
on that build). What the tree's pages do in those seconds was not looked into; twenty seconds on,
the tree reads the 1.9 to 3.6 % above. The same spec's
minimized window came back to its first frame in 575 to 600 ms on this branch and 572 ms on that
build, over its 500 ms budget on both: the machine's screen was on, and the OS says a minimized
window shows once its animation ends. That budget was recorded behind a locked screen and is left
as it is here.

The hidden page's pace (`e2e/specs/resident.spec.ts`): forty timers of 10 ms ended within 5 s on the
hidden page; Chromium's own rule would have made them take 40 s.
