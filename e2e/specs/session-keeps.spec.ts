// What the person closed, put away and placed stays so (issue 163): a window closed by its × stays
// closed across a relaunch, a side window (Status, a right-hand surface) too, and none comes back
// twice (finding 3); a window in the drawer stays there when ⌘W closes another (finding 6); ⌘W
// closes the window a title-bar press put in use, not a pane used before it (finding 5); and the app
// window comes back where it was and as large (finding 9). Presses and keys are the compositor's
// (support/compositor.ts, gestures.ts): the screen may be locked. browser.reloadSession() quits the
// app and starts it again with the same HOME (support/driver.ts); the spec polls the data files
// before each relaunch. The app window's frame is set as a drag and a resize would set it
// (`compositor_window { frame }`), and that case comes last: the cases share the spec's HOME.
import { browser, expect } from "@wdio/globals";
import { feed, keyPress, shellCommand } from "../support/compositor";
import { dataFile, shellReady, waitForData } from "../support/desk";
import { bodyAt, click, type Point, titleAt, toolAt } from "../support/gestures";
import {
  byId,
  type Desk,
  deskNow,
  onScreen,
  type Rect,
  rectOf,
  run,
  until,
  windowUntil,
} from "../support/windows";

const STATUS = "endue.toolbar";
const CALENDAR = "endue.calendar";
const NOTES = "endue.notes";
const MAIL = "endue.mail";
const TERMINAL = "endue.terminal";
const DATABASE = "endue.database";

type Frame = { x: number; y: number; width: number; height: number };
type Store = { desk?: { session?: { parts?: { shell?: { shows?: string[] } } } } };
const shows = (value: unknown) => (value as Store | undefined)?.desk?.session?.parts?.shell?.shows;

/** The windows on the desktop in front, by id. */
const ids = (desk: Desk) =>
  onScreen(desk)
    .map((w) => w.id)
    .sort();

/** ⌘W (Control+W elsewhere) as the keyboard sends it. */
const closeKey = () =>
  feed([
    { type: "modifiers", ...(process.platform === "darwin" ? { meta: true } : { ctrl: true }) },
    ...keyPress("w", "KeyW", "w"),
    { type: "modifiers" },
  ]);

/** Bring window `id` in front, as its dock tile does; where it is once its chrome is drawn there. */
async function inFront(id: string): Promise<Rect> {
  await run("desk.plugins.open", { plugin: id });
  const w = await windowUntil(id, (w) => w.focused === true, "never came in front");
  await browser.pause(400);
  return rectOf(w);
}

/** A press by pointer, then the desk a moment later. */
async function press(at: Point): Promise<void> {
  await click(at);
  await browser.pause(400);
}

describe("session: what the person closed, put away and placed stays so", () => {
  it("windows closed by their × stay closed across a relaunch, a side window too, and none comes back twice", async () => {
    await shellReady();
    for (const id of [STATUS, CALENDAR]) {
      await press(toolAt(await inFront(id), "close"));
      await until((d) => byId(d, id) === undefined, `${id} never closed`);
    }
    const before = ids(await deskNow());
    await waitForData(
      "store.json",
      (value) => {
        const shown = shows(value);
        return Array.isArray(shown) && !shown.includes(STATUS) && !shown.includes(CALENDAR);
      },
      "a session that shows neither closed window",
    );

    await browser.reloadSession();
    await shellReady();
    const same = (desk: Desk) => JSON.stringify(ids(desk)) === JSON.stringify(before);
    await until(same, "the relaunch did not put back the windows open at the quit", 15_000);
    // Nothing opens a second copy late: the restore and the first layout are done by now.
    await browser.pause(2_000);
    expect(ids(await deskNow())).toEqual(before);
  });

  it("a window in the drawer stays there when ⌘W closes another, and ⌘W after a title-bar press closes that window", async () => {
    await shellReady();
    // Notes is used, then put away in the drawer by its own tool.
    await press(bodyAt(await inFront(NOTES)));
    await press(toolAt(rectOf(await windowUntil(NOTES, () => true, "is gone")), "drawer"));
    await until((d) => byId(d, NOTES)?.hidden === true, "Notes never went to the drawer");
    // Mail is used and closed with ⌘W: the window shown next is not the one in the drawer.
    await press(bodyAt(await inFront(MAIL)));
    await closeKey();
    const after = await until((d) => byId(d, MAIL) === undefined, "⌘W never closed Mail");
    await browser.pause(1_000);
    const desk = await deskNow();
    expect(byId(desk, NOTES)?.hidden).toBe(true);
    expect(onScreen(desk).find((w) => w.focused)?.id).not.toBe(NOTES);
    expect(ids(desk)).toEqual(ids(after));

    // A pane of the Terminal is used (Split right opens a launcher pane in use), then a press on
    // Database's title bar puts Database in use: ⌘W closes Database, the Terminal keeps its panes.
    await press(toolAt(await inFront(TERMINAL), "split-right"));
    await windowUntil(TERMINAL, (w) => w.panes.length === 2, "never split");
    await press(titleAt(await inFront(DATABASE)));
    await windowUntil(DATABASE, (w) => w.focused === true, "a title-bar press left it out of use");
    await closeKey();
    await until((d) => byId(d, DATABASE) === undefined, "⌘W never closed Database");
    await browser.pause(500);
    expect(byId(await deskNow(), TERMINAL)?.panes).toHaveLength(2);
  });

  it("the app window comes back where it was and as large", async () => {
    await shellReady();
    const first = await shellCommand<Frame>("compositor_window", { frame: true });
    const wanted: Frame = { x: first.x + 40, y: first.y + 30, width: 1100, height: 700 };
    const set = await shellCommand<Frame>("compositor_window", { frame: wanted });
    expect(set).toEqual(wanted);
    await waitForData(
      "desk-window.json",
      (value) => JSON.stringify(value) === JSON.stringify(wanted),
      `the frame ${JSON.stringify(wanted)}`,
    );

    await browser.reloadSession();
    await shellReady();
    expect(await shellCommand<Frame>("compositor_window", { frame: true })).toEqual(wanted);
    expect((await deskNow()).screen).toEqual({ w: 1100, h: 700 });
    expect(dataFile("desk-window.json")).toEqual(wanted);
  });
});
