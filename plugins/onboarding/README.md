# plugins/onboarding

The first run, scenes 1–10 of `docs/ko/first-run-scenario.md`, as a built-in UI plugin on an `overlay`
surface. It closes itself when it is done.

| Scene | What happens | File |
| --- | --- | --- |
| 1 Arrival | Warp, a count of three, the floor unfolding, a beam that becomes the core, polygons locking in (gold last), Dysnomia; Web Audio cues | `ui/arrival.js`, `ui/sound.js` |
| 2–4 | Greeting, microphone (`perm.request`), name | `ui/meet.js` |
| 5 | endue ID at auth.endue.ai (ADR 0111): the web's entry with Sign in, Create account and Skip for now; `account.signIn` opens the browser, the code waits with Open browser again and Cancel, `account.changed` ends it; every failure worded with a retry | `ui/account.js`, `ui/sign-in.js` |
| 6–7 | The desk's frame switches on; cards connect sources (stub: sample data); Tin and Seed join and speak, Muse waits | `ui/desk.js` |
| 8–10 | The first task builds a screen (sample data, or `brain.say`); the layout is named into the dock; Eris settles in the left bar | `ui/work.js`, `ui/panels.js` |

`ui/director.js` holds the timeline, soul text and voice, questions, poses and the store; `ui/flow.js`
the scene order (Skip intro asks for the microphone and name before the first task; outside the US, or
after Skip for now, the agents scene is left out); `ui/script.js` every line and time; `ui/samples.js`
the sample calendar and folder. The manifest declares `account:manage`, which a built-in gets.

Branches: 8 s of silence nudge once; offline waits and resumes the scene; three failed sign-ins add a
help line. Progress is kept with `store.set("first-run", …)` at every scene from the microphone on, so
a first run that was quit resumes there ("Where were we?"); a finished one only says "Morning, <name>."
after a 1.2 s assembly. Layouts are kept under `layouts.endue`. Reduced motion leaves out the warp and
the floor and uses short fades. Eris speaks with a female system voice (`eris/voice.js`); automated
browsers stay silent.

Not yet: folder picker and connectors; the account-name question after sign-in; the
"new device" and later-visit introductions; "Keep captions longer".

Every colour, font, size, radius and duration comes from the theme's `--desk-*` tokens, so the first
run follows dark, light and high contrast; Eris's orb takes the `eris*` tokens through
`eris/soul-text.css`, and the agents wear the category colours `chart-2`, `chart-6` and `chart-5`.

Tests: `plugins/onboarding/tests` (vitest; `theme.test.ts` for the tokens),
`packages/runtime/e2e/onboarding.spec.ts` and `first-run-tour.spec.ts` (render-tree snapshots on a
fake clock, every branch). Frame time: `just perf-opening`.
