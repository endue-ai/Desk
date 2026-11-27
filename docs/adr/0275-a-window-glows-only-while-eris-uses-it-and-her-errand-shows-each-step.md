---
status: accepted
date: 2026-11-19
decision-makers: Team endue
---

Amends ADR 0271 (no window glows because she only looks at it, and an errand waits for its line) and
ADR 0089 (the errand's steps). Builds on ADR 0254 (she rests in the talk line and comes out to work).

# A window glows only while Eris uses it, and her errand shows each step from the line to the answer

## Context and Problem Statement

Since ADR 0271 every line that came in with the desk lit the window in use softly and sent a bare
spark there and back, whether or not she did anything with it. A window that glows for a line about
the weather says she worked on it when she did not, and the glow that matters, a window her command
runs on, no longer stands out. The steps of a turn did not read in order either: an errand left her
as soon as the brain asked for it, often while the line was still flying into her, nothing showed
her reading it, the window lit before the spark reached it, and the answer faded out within the first
half of its way back. How does the person see how she works a line: it reaching her, her reading it,
the request going to a window, the window working and the answer coming back?

## Decision Drivers

* A window glows only while she uses it: from the moment her request reaches it until its plugin
  has answered. A line that runs nothing lights nothing
* Each step shows, one after the other, in the order the data moves
* No contract changes (`specs/bridge`), and the compositor's glow stays as ADR 0271 made it
* Reduced motion means no motion; a desk at rest draws nothing (ADR 0164)

## Considered Options

* Drop the look; the errands wait for the line and her reading of it; her ring shows what she is at;
  a window lights as its spark lands; the answer flies back whole, in the star's colour
* Keep the look and only make it fainter
* Draw the steps as they happen, each as soon as the brain or the core says so

## Decision Outcome

Chosen option: the first, because it is the only one where the glow means a window is in use and
the steps read in the order they happen to the data.

* **The line in her** (`errand.ts`, `ask`): the talk line hands the errands the line's flight into
  her (Composer's 1.4 s); once it lands she takes it in (a ring closing into her core) and reads it
  for `READ_MS` (480 ms). Her errands for the line, and her answer, wait for that. A spoken turn has
  no flight and waits for nothing.
* **Her ring** (`mind.ts`, `eris.css`): three arcs with a mote at each head and an inner pair, in
  the star's colour round her body, floating with her. It turns while she reads a line or an answer
  (`data-mind="reading"`, or a spoken turn's `data-talk="thinking"`), dims and loses its motes while
  her errands are out (`waiting`), and goes when the turn is over. A request leaving her opens a
  ring out of her core, an answer reaching her closes one into it (`takeIn`, on the ticker).
* **The request**: her gold spark with the plugin's name and the command's title, along its thread.
  The window lights when the spark lands, not when the errand starts; a window a desk command names
  lights when the spark that flew on to it lands, or at once if the spark went elsewhere first. The
  spark stays at the window at least `DWELL_MS` (520 ms) before the answer may leave: in the app a
  plugin often answers before the spark lands, and its window would light and go dark at once.
* **Which windows**: as before, every window that shows the plugin, found in the desk's page and the
  windows' own pages, and now also every window the window manager places with the plugin in it
  (`windowsShowing`), whose page the desk's cannot read.
* **The answer**: on `tool-result` the window's glow goes and the spark flies back in the star's
  colour, its label edged in it, whole until the last part of the way (`1 - t⁶`), and she takes it
  in and reads it (`thinking`) until her reply; one that failed is grey and she shows `oops`.
* **No look**: `look`, `seenIn` and `LOOK` are gone; the desk still goes to her brain with each line.
* **Reduced motion**: the line fades where it was, she reads it at once, no ring turns or closes,
  the windows light at once and nothing flies.

### Consequences

* Good, because a glowing window now always means she is using it, and the order of the steps on
  screen is the order of the data
* Good, because nothing in `specs/` or the compositor changes
* Bad, because the drawing lags the work: a fast brain's first errand shows up to 1.9 s after the
  line was sent, each errand takes at least two legs and a stay (1.8 s), and her answer waits for
  the line to be in her and read (it waited for the errands already); a slow brain hides it
* Bad, because "this" in a line has no mark on screen any more; the window in use is still what the
  brain hears as "this"
* Neutral: the star's colour is also her ring's, the same meaning, an agent at work
  (`docs/design-system.md`, principle 2)

### Confirmation

`packages/runtime/src/eris/{errand,errand-ask,errand-uses,mind,visiting}.test.ts`; painted in
`packages/runtime/e2e/eris-errand.spec.ts` (a line that runs nothing lighting no window and her ring
reading it; the errand waiting for the line, the window lit once its spark lands, the answer going
back), and in the app, from the compositor's own frame with examples/brain-echo answering, in
`e2e/specs/eris-glow.spec.ts` (no rim for a line that runs nothing; the rim of Mail's window while
"check my latest mail" runs its command, dark after).

## More Information

`docs/ko/desk-structure.md` names `eris/` only: no section of it changes. Code:
`packages/runtime/src/eris/{errand,errand-targets,mind,visiting,Eris}.ts`, `eris.css`, `errand.css`,
`shell/Composer.ts`.
