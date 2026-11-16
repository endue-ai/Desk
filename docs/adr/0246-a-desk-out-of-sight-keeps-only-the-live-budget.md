---
status: accepted
date: 2026-11-16
decision-makers: Team endue
---

Amends ADR 0142 (a desk out of sight has no window in sight), ADR 0225 (what a resident desk holds).

# A desk out of sight keeps only the live budget, and its hidden overlays sleep

## Context and Problem Statement

`e2e/perf/budgets.json` recorded endue at rest with its window closed (ADR 0225) at 3,555 MB RSS in
29 processes. We measured where the memory goes on 2026-11-16 (#312). The setup was main 21b7200d,
a debug bundle with chromedriver attached, on the reference machine (Apple M4 Max). Every other
session was paused, and each run started at a 1-minute load average of 1.0 to 3.1. We ran
`just perf-app`'s specs alone, with a sampler beside them reading `ps` and `footprint` for each
process.

| Run | Tree RSS | Renderers | Browser | GPU | Network | Storage |
| --- | --- | --- | --- | --- | --- | --- |
| Window closed, 50 s (three runs) | 3,425 to 3,445 MB | 24: 2,868 MB | 286 to 298 | 133 to 139 | 77 | 61 |
| Window in sight, 5 min (two runs) | 3,538 to 3,552 MB | 24: 2,913 to 2,925 MB | 342 | 140 | 78 | 61 |

* A renderer holds 116 MB of RSS at the median. Its own memory is about 35 MB of physical
  footprint: RSS also counts the framework pages that every helper maps again.
* The renderers are the desk's own and one per plugin page (#36). On the Default profile that is
  14 windows and 5 overlays that were never shown: the launcher, the palette's plugin, permissions,
  universal and views.
* A desk with no plugin page holds 880 MB.

So the memory follows the number of renderers. No CEF switch shrinks a renderer's own 35 MB, and
isolation per plugin stays (ADR 0140).

With the window closed, nothing slept, for two reasons:

* `Hosted::occluded` only hid the surfaces. The live budget (ADR 0142) was still given the window
  manager's `plan.shown`, which counts every window on the desktop in front as in sight, so neither
  `desk.surfaces.live` nor `desk.display.unload-after` ever applied. ADR 0225 says they do.
* The runtime's policy counted windows only (`frames/install.ts`), so a hidden overlay kept its
  renderer for as long as the desk ran.

## Decision Drivers

* A desk nobody sees costs no more than the live budget allows (#312: 30 % under 3,555 MB)
* No visible change: a surface brought back shows its state (`desk:state`, ADR 0070)
* Isolation per plugin stays; the motion gate stays green (ADR 0208)

## Considered Options

* Out of sight is out of sight: the budget sees no window in sight, and hidden overlays sleep
* Share one renderer between plugins (`--renderer-process-limit` lower, or one site)
* Lower `desk.surfaces.live` for everyone
* Start overlays only when first shown

## Decision Outcome

Chosen option: "out of sight is out of sight", because it applies the budget the person already
sets, and adds no new number.

* While the shell's `occluded` is set (the window closed, minimized, or covered as the OS says), the
  live budget is decided with no window in sight and no window with the keys
  (`compositor_window/hosted.rs`).
  * The `desk.surfaces.live` most recent windows stay live, and the rest sleep at once.
  * Past `desk.display.unload-after`, all of them sleep.
  * When the window shows again, the plan's windows are in sight once more and wake.
* In the app, a hidden overlay sleeps while the desk's page is hidden, and loads again with its state
  in three cases: when the page shows, when the overlay is shown, or when something waits on its
  answer (`frames/install.ts`). The runtime never takes the frame of the surface with the keys.
* `resident.perf.ts` and `memory.perf.ts` report the tree's RSS by kind of process (`kinds`).

Measured after, on the branch on 55ed3326 under the same conditions:

* Window closed, in three runs that started at a load of 3.8 to 4.0: 2,270.8, 2,258.5 and
  2,270.2 MB, in 19 processes, 14 of them renderers (1,697 to 1,709 MB). The eight most recent
  windows stay, beside the one with the keys.
* Window in sight, unchanged: 3,540.5 and 3,580.1 MB.

`residentAtRest.rssBudgetMb` is now 2,500 MB, the largest reading plus a tenth. `idleMemory` has
its first baseline, 3,560.3 MB.

### Consequences

* Good, because a resident desk holds 36 % less than the recorded 3,555 MB.
* Good, because a closed or covered desk now follows the setting's own description ("another
  desktop, behind other windows").
* Bad, because a window past the budget wakes when the desk comes back. It shows its last frame
  greyed for about one first paint (137 to 248 ms, ADR 0142).
* Bad, because a sleeping overlay summoned while the desk is out of sight loads first.
* Bad, because `startup` still has no baseline. The start-up spec times out on main at its sixth
  file in the runtime's open path for autoload plugins, which went to #339.

## More Information

#312; ADR 0142, ADR 0225; `e2e/perf/budgets.json` (`residentAtRest`, `idleMemory`).
