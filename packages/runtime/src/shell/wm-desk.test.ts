// The store as crates/desk-wm reads it (#81): each desktop's layout as this desk draws it, the
// session folded in, and the titles of the shell's own views on the desktop in front.
import { describe, expect, it } from "vitest";
import { desktopId, desktopsOf, layoutOf, moveSurface, setDesktop } from "./actions";
import { Store, sampleState } from "./state";
import { newWindow, splitPane } from "./windows";
import { wmDesk, wmTitles } from "./wm-desk";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

function ctx() {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  return {
    store,
    runtime: {
      shortcuts: { focused: null },
      focusSurface() {},
      plugins: { unmount() {} },
    } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

describe("the window manager's desk (wmDesk)", () => {
  it("names every desktop with its layout as drawn and the desktop in front", () => {
    const c = ctx();
    c.store.set({ adopted: [{ id: "endue.notes", title: "Notes", slot: 0 }] });
    moveSurface(c, "endue.notes", { x: 40, y: 60, w: 600, h: 400 });
    setDesktop(c, "2");
    const s = c.store.get();
    const desk = wmDesk(s);
    expect(desk.saved.list.map((d) => d.id)).toEqual(desktopsOf(s).map((d) => d.id));
    for (const d of desktopsOf(s)) expect(desk.saved.desktops[d.id]).toEqual(layoutOf(s, d.id));
    expect(desk.saved.desktops["1"]?.surfaces.map((p) => p.id)).toEqual(["endue.notes"]);
    expect(desk).toMatchObject({ desktop: desktopId(s), session: {}, desktops: null });
    expect(desk.adopted).toEqual(s.adopted);
    // The drawer's times in whole milliseconds, as desk-wm reads them.
    c.store.set({
      drawer: [{ id: "file-x", kind: "file", name: "x.pdf", at: epoch + 0.4 }],
    });
    expect(wmDesk(c.store.get()).drawer[0]?.at).toBe(epoch);
    // Plain JSON: what the page sends the shell.
    expect(JSON.parse(JSON.stringify(desk))).toEqual(desk);
  });

  it("titles the shell's own views of the desktop in front, never a plugin's", () => {
    const c = ctx();
    c.store.set({ adopted: [{ id: "endue.notes", title: "Notes", slot: 0 }] });
    newWindow(c);
    splitPane(c, "row");
    expect(wmTitles(c.store, c.tr)).toEqual({ launcher: "launcherTitle" });
    // In the desk's language by default.
    expect(wmTitles(c.store).launcher).not.toBe("launcherTitle");
  });
});
