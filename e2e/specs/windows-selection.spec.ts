// Dragging a title never selects the desk's text, and text stays selectable after (#82), the twin
// of packages/runtime/e2e/shell-selection.spec.ts on the CEF desk. No bridge call reads the page's
// selection, so the screen does: selected text is drawn highlighted. A window dragged by its title
// shows the same picture where it is dropped (no highlight anywhere in it); a drag across the
// note's text afterwards changes the text's picture (the highlight); and the title bar's tools
// still answer the pointer.
import { expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import {
  chord,
  click,
  drag,
  KEY,
  release,
  TITLE_BAR,
  titleAt,
  toolAt,
  type,
} from "../support/gestures";
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

const TEXT = "Ordinary note text remains selectable after moving a window.";

describe("selection: dragging a title selects nothing (#82)", () => {
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

  for (const finish of ["drop", "Escape"] as const) {
    it(`dragging a title never selects the desk; text remains selectable after ${finish}`, async () => {
      const id = await openWindow();
      await run("desk.shell.open-notes");
      const win = await windowUntil(id, (w) => w.panes[0]?.view === "notes", "shows Notes");
      // The note being written: the text box along the window's bottom (the notes view lists the
      // notes above it).
      const box = (at: Rect) => ({ x: at.x + 20, y: at.y + at.h - 58 });
      await click(box(rectOf(win)));
      await type(TEXT);
      const { w } = (await deskNow()).screen;
      const before = await settled(w);
      const grab = titleAt(rectOf(win), 60);
      const to = { x: grab.x + 160, y: grab.y + 100 };
      await drag(grab, to, { steps: 10, hold: true });
      if (finish === "Escape") await chord(KEY.escape);
      await release();
      const after =
        finish === "drop" ? await windowUntil(id, (x) => x.x !== win.x, "dropped") : win;
      if (finish === "Escape") expect(rectOf(await windowNow(id))).toEqual(rectOf(win));
      // Nothing highlighted: the notes listed above the box show the same picture where the window
      // now is (the box itself may show the focus leaving it).
      const notes = (at: Rect) => ({ x: at.x + 10, y: at.y + TITLE_BAR + 6, w: at.w - 20, h: 140 });
      const still = await settled(w);
      expect(difference(still, notes(rectOf(after)), before, notes(rectOf(win)))).toBeLessThan(
        0.005,
      );
      // Selecting the note's text with the pointer draws it highlighted.
      const from = box(rectOf(after));
      await drag(from, { x: from.x + 180, y: from.y }, { steps: 8 });
      const row = { x: from.x - 6, y: from.y - 10, w: 200, h: 20 };
      const selected = await settled(w);
      expect(difference(selected, row, still, row, { tolerance: 2 })).toBeGreaterThan(0.05);
      // A title bar's tools still answer the pointer.
      await click(toolAt(rectOf(after), "drawer"));
      await until((d) => !onScreen(d).some((x) => x.id === id), "put in the drawer");
    });
  }
});
