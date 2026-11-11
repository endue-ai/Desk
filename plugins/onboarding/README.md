# plugins/onboarding

The first run, scenes 1–10 of `docs/ko/first-run-scenario.md`, as a built-in UI plugin on an `overlay`
surface. It closes itself when it is done.

| Scene | What happens | File |
| --- | --- | --- |
| 1 Arrival | Warp, a count of three, the floor unfolding, a beam that becomes the core, polygons locking in (gold last), Dysnomia; Web Audio cues | `ui/arrival.js`, `ui/sound.js` |
| 2–4 | Greeting; the microphone, asked of the person (Use my microphone, Not now) and only after a yes of the desk (`perm.request`, "Waiting for your approval" while it asks), so she says she listens only after both; name | `ui/meet.js` |
| 5 | endue ID at auth.endue.ai (ADR 0111): the web's entry with Sign in, Create account, its note and Skip for now in one block; `account.signIn` opens the browser, the code waits with Open browser again and Cancel, `account.changed` ends it; every failure worded with a retry | `ui/account.js`, `ui/sign-in.js` |
| 6–7 | The desk's frame switches on; cards choose sources and a second press takes one back (stub: sample data, said so); Tin and Seed join and speak, Muse waits | `ui/desk.js` |
| 8–10 | The first task builds a screen (sample data, or `brain.say`); the layout is named into the dock; Eris settles in the left bar | `ui/work.js`, `ui/panels.js` |

`ui/director.js` holds the timeline, soul text and voice, questions, poses and the store; `ui/fit.js`
fits the stage to the window from 1024×500 up (the orb gives way; the caption, forms and choices keep
their size, the form also when Eris stands up or aside); `ui/flow.js` the scene order (Skip intro asks
for the microphone and name before the first task; outside the US, or after Skip for now, the agents
scene is left out); `ui/script.js` every line and time; `ui/samples.js` the sample calendar and folder.

Branches: 8 s of silence nudge once, then the question again; offline waits and resumes the scene;
three failed sign-ins add a help line. A line that starts while the one before it scatters sends it off.
Progress is kept with `store.set("first-run", …)` at every scene from the microphone on, so a first run
that was quit resumes there ("Where were we?"); a finished one only greets by the hour ("Morning,
<name>.", Afternoon, Evening) after a 1.2 s assembly. Layouts are kept under `layouts.endue`. Reduced
motion leaves out the warp and the floor and uses short fades. Eris speaks with a female system voice
(`eris/voice.js`); automated browsers stay silent. The manifest declares `account:manage`.

Not yet: folder picker and connectors; hearing the person (a yes only changes how she asks); the
account-name question after sign-in; the "new device" and later-visit introductions; "Keep captions longer".

Every colour, font, size, radius and duration comes from the theme's `--desk-*` tokens; Eris's orb takes
the `eris*` tokens through `eris/soul-text.css`, the agents the category colours `chart-2`, `-6`, `-5`.

Tests: `plugins/onboarding/tests` (vitest; `theme.test.ts` for the tokens), `packages/runtime/e2e/`
`onboarding.spec.ts` and `first-run-tour.spec.ts` (render-tree snapshots on a fake clock, every branch)
and `first-run-fits.spec.ts` (every scene's choices inside 1024×500, 1280×800 and 1500×950, none on
another, the theme's buttons). Frame time: `just perf-opening`.
