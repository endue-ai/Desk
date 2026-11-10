// Drags and resizes held, cancelled and cut short (#82), the twin of
// packages/runtime/e2e/shell-interactions.spec.ts on the CEF desk. Rects come from
// desk.windows.list, which lists where a window is placed: a drag in progress is only on screen,
// so the screen is read there (a window held by its title shows its own pixels under the
// pointer). Left with their runtime twins: the cursors, the app losing focus mid-resize (no
// bridge call blurs the desk), the dividers' keyboard focus (desk.windows.list has no ratios) and
// the profile dialogs' focus trap, which are the chrome's and the dialogs' rather than the window
// manager's (#80 moves the cursor and the dividers to the compositor).
import { expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { chord, drag, gripAt, KEY, release, titleAt } from "../support/gestures";
import { difference, settled } from "../support/pixels";
import {
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  onScreen,
  openWindow,
  type Rect,
  rectOf,
  run,
  until,
  windowNow,
  windowUntil,
} from "../support/windows";

/** The window's own pixels: inside its border and shadow. */
const INSET = 4;
/** Shares of a window's pixels: the same picture (a hovered control may differ), and another. */
const SAME = 0.005;
const OTHER = 0.5;
/** A window's body is a shade off the canvas: a colour step of 2 tells them apart. */
const FINE = { tolerance: 2 };

describe("interactions: drags and resizes held, cancelled and cut short (#82)", () => {
  before(async () => {
    await shellReady();
    await clearDesk();
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await release().catch(() => {});
    await closeShellWindows();
  });

  it("a held drag shows the window under the pointer through a redraw, and Escape puts it back", async () => {
    const id = await openWindow();
    // The calendar draws a picture of its own, which a shifted copy of it does not match.
    await run("desk.shell.open-calendar");
    const win = await windowUntil(id, (x) => x.panes[0]?.view === "calendar", "shows Calendar");
    const { w } = (await deskNow()).screen;
    const before = await settled(w);
    const grab = titleAt(rectOf(win));
    const to = { x: grab.x + 80, y: grab.y + 50 };
    await drag(grab, to, { hold: true });
    const moved: Rect = { ...rectOf(win), x: win.x + 80, y: win.y + 50 };
    const held = await settled(w);
    expect(difference(held, moved, before, rectOf(win), { inset: INSET })).toBeLessThan(SAME);
    expect(difference(held, rectOf(win), before, rectOf(win), { inset: INSET })).toBeGreaterThan(
      0.1,
    );
    // Something else redraws the desk meanwhile (a setting changes): the drag holds.
    await run("desk.shell.soul-solemn");
    const redrawn = await settled(w);
    expect(difference(redrawn, moved, before, rectOf(win), { inset: INSET })).toBeLessThan(SAME);
    await chord(KEY.escape);
    await release();
    expect(rectOf(await windowNow(id))).toEqual(rectOf(win));
    const after = await settled(w);
    expect(difference(after, rectOf(win), before, rectOf(win), { inset: INSET })).toBeLessThan(
      SAME,
    );
    await run("desk.shell.soul-wisp");
  });

  it("Escape during a resize keeps the window's size", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    const { w } = (await deskNow()).screen;
    const before = await settled(w);
    const grip = gripAt(rectOf(win), "se");
    await drag(grip, { x: grip.x + 48, y: grip.y + 48 }, { hold: true });
    // The window grows on screen under the pointer: past its old corner is window now.
    const grown: Rect = { x: win.x + win.w + 8, y: win.y + win.h + 8, w: 24, h: 24 };
    expect(difference(await settled(w), grown, before, grown, FINE)).toBeGreaterThan(OTHER);
    await chord(KEY.escape);
    await release();
    expect(rectOf(await windowNow(id))).toEqual(rectOf(win));
    expect(difference(await settled(w), grown, before, grown, FINE)).toBe(0);
  });

  it("closing a window during a drag lets the pointer go, and the next window works", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    const grab = titleAt(rectOf(win));
    await drag(grab, { x: grab.x + 40, y: grab.y + 30 }, { hold: true });
    // ⌘W while the pointer still holds it: the window in use closes.
    await run("desk.display.close-pane");
    await until((d) => !onScreen(d).some((x) => x.id === id), "the window closed");
    await release();
    const next = await openWindow();
    await run("desk.shell.open-notes");
    const notes = await windowUntil(next, (x) => x.panes[0]?.view === "notes", "shows Notes");
    const from = titleAt(rectOf(notes));
    await drag(from, { x: from.x + 60, y: from.y + 40 });
    const moved = await windowUntil(next, (x) => x.x !== notes.x, "moved by the pointer");
    expect(rectOf(moved)).toEqual({ ...rectOf(notes), x: notes.x + 60, y: notes.y + 40 });
  });
});
