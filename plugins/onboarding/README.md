# plugins/onboarding

The first run, scenes 1–5 of `docs/ko/first-run-scenario.md`, as a built-in UI plugin on an `overlay`
surface. It closes itself when it is done.

| Scene | What happens |
| --- | --- |
| 1 Arrival | The orb assembles from a core of light (simplified: no warp, count or 3D floor yet) |
| 2 First greeting | "Hello. I'm E.R.I.S. …" with the prototype's `LINES` timings (`ui/script.js`) |
| 3 Microphone | `perm.request` for `audio:capture`; allowed: listening; refused: typing from here on |
| 4 Name | The name rises into the orb; an empty answer is asked for again |
| 5 endue ID | Stubbed: Success, New account or Failure (with "Open it again") |

Skip intro appears after 1 s and jumps to scene 5. With `prefers-reduced-motion` everything becomes a
short fade. A finished first run is kept with `store.set("first-run", { done, name })`; the next run
only says "Morning, <name>." after a 1.2 s assembly. Screen readers get each whole sentence from an
`aria-live="polite"` region; Skip and the name field work from the keyboard.

Soul text, the orb and the timeline come from `plugins/eris` through the import map (`eris/`).
Tests: `packages/runtime/e2e/onboarding.spec.ts` (six render-tree snapshots on a fake clock, and every
branch). Frame time: `just perf-opening`.
