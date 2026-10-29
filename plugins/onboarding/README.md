# plugins/onboarding

The first run, scenes 1–10 of `docs/ko/first-run-scenario.md`, as a built-in UI plugin on an `overlay`
surface. It closes itself when it is done.

| Scene | What happens | File |
| --- | --- | --- |
| 1 Arrival | Warp, a count of three, the floor unfolding, a beam that becomes the core, polygons locking in (gold last), Dysnomia; Web Audio cues | `ui/arrival.js`, `ui/sound.js` |
| 2–5 | Greeting, microphone (`perm.request`), name, endue ID (stub: Success, New account, Failure, Outside the US) | `ui/meet.js` |
| 6–7 | The desk's frame switches on; cards connect sources (stub: sample data); Tin and Seed join and speak, Muse waits | `ui/desk.js` |
| 8–10 | The first task builds a screen (sample data, or `brain.say`); the layout is named into the dock; Eris settles in the left bar | `ui/work.js`, `ui/panels.js` |

`ui/director.js` holds the timeline, soul text and voice, questions, poses and the store; `ui/flow.js`
the scene order (Skip intro asks for the microphone and name before the first task; outside the US the
agents scene is left out); `ui/script.js` every line and time; `ui/samples.js` the sample calendar and
folder.

Branches: 8 s of silence nudge once; offline waits and resumes the scene; three failed sign-ins add a
help line. Progress is kept with `store.set("first-run", …)` at every scene from the microphone on, so
a first run that was quit resumes there ("Where were we?"); a finished one only says "Morning, <name>."
after a 1.2 s assembly. Layouts are kept under `layouts.endue`. Reduced motion leaves out the warp and
the floor and uses short fades. Eris speaks with a female system voice (`eris/voice.js`); automated
browsers stay silent.

Not yet: real endue ID, folder picker and connectors; the account-name question after sign-in; the
"new device" and later-visit introductions; "Keep captions longer".

Tests: `plugins/onboarding/tests` (vitest), `packages/runtime/e2e/onboarding.spec.ts` and
`first-run-tour.spec.ts` (render-tree snapshots on a fake clock, every branch). Frame time:
`just perf-opening`.
