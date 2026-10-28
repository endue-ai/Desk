---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# Plugin animations are paused Web Animations positioned from an injected clock

## Context and Problem Statement

The first run is a timed performance: soul text, the orb assembling, lines that scatter. Its tests
must freeze it at fixed times (3.0 s, 8.8 s, 19.3 s, 2.4 s after a reply) and get the same result on
every run and every OS. The reference prototype animates with CSS keyframes and `animation-delay`,
which run on the compositor and cannot be stopped at a chosen time. How do we keep the prototype's
look and still freeze it?

## Decision Drivers

* Port the prototype's keyframes and easings unchanged
* Deterministic test snapshots at fixed times, inside sandboxed plugin frames
* No test-only code paths in plugins
* Plain JS plugins without a build step

## Considered Options

* Web Animations created paused, positioned every frame from a clock (`requestAnimationFrame`
  frame times); tests replace that clock with Playwright's fake clock
* CSS animations, with tests waiting real time
* Hand-written interpolation in JS

## Decision Outcome

Chosen option: "paused Web Animations on an injected clock" (`plugins/eris/ui/timeline.js`). Each
glyph and orb part gets `element.animate(keyframes, { delay, duration, easing })` with the
prototype's values; its effect then moves to an animation with no document timeline, which is
positioned from the timeline's clock on every frame. A plain `pause()` is not enough: WebKit settles a
pending pause on a later rendering frame against the real document timeline, which shifted the endless
idle loops by real milliseconds on busy CI machines. Scene cues run on the same timeline.

The timeline starts at its first frame and its time is the latest frame's time, never
`performance.now()`: under the fake clock `now()` keeps the real milliseconds between installing and
pausing the clock, and in an event handler it would also depend on when the input arrived, so either
would shift the scene by a millisecond from run to run. In tests, Playwright's fake clock (installed
for every frame, sandboxed ones included) pauses time; `clock.runFor(ms)` steps it exactly.

Bridge answers (a permission prompt, for example) only choose branches; when the next line starts is
decided by script times, so asynchronous replies cannot shift a snapshot.

### Consequences

* Good, because the browser still does the interpolation with the prototype's easings, and the
  snapshots are exact and repeatable.
* Good, because plugins contain no test hooks: the same code runs in the app and in tests.
* Bad, because every animation must go through the timeline; a stray CSS animation would not freeze.
* Bad, because frames advance in 16 ms steps under the fake clock, so a snapshot "at 3.0 s" is the
  last frame at or before 3.0 s.

## More Information

Snapshots are render trees without layout boxes (ADR 0011). Issue #11.
