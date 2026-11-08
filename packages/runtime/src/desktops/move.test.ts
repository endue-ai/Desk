import { describe, expect, it } from "vitest";
import type { DesktopLayout, SurfacePlacement } from "../modes/types";
import { layoutOf, windowsOf } from "../shell/actions";
import { type DeskState, emptyState } from "../shell/state";
import { holderOf, movedBack, moveWindow } from "./move";

const notes: SurfacePlacement = {
  id: "notes",
  plugin: "endue.notes",
  x: 300,
  y: 200,
  w: 420,
  h: 360,
  pinned: true,
  panes: { kind: "view", id: "p1", view: "notes" },
};
const layout = (...surfaces: SurfacePlacement[]): DesktopLayout => ({
  surfaces,
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
});
const apply = (s: DeskState, patch: Partial<DeskState> | undefined): DeskState => ({
  ...s,
  ...patch,
});
const on = (s: DeskState, desktop: string) => windowsOf(s, desktop).map((p) => p.id);

/** Notes in use on desktop 1, panned; desktop 3 panned differently. */
function desk(): DeskState {
  return {
    ...emptyState("en"),
    session: { "1": layout(notes) },
    pan: { "1": { x: -100, y: 0 }, "3": { x: 50, y: 40 } },
    focused: "notes",
    pane: "p1",
  };
}

describe("moving a window to another desktop", () => {
  it("keeps its size, panes and place on screen", () => {
    const result = moveWindow(desk(), "notes", "3");
    const s = apply(desk(), result?.patch);
    expect(on(s, "1")).toEqual([]);
    const there = layoutOf(s, "3").surfaces[0];
    // On screen it sat at 300 - 100 = 200, 200; desktop 3 is panned by 50, 40.
    expect(there).toEqual({ ...notes, x: 150, y: 160 });
  });

  it("is the window in use on the desktop it went to, and the desk stays where it is", () => {
    const s = apply(desk(), moveWindow(desk(), "notes", "3")?.patch);
    expect(s.desktop).toBe("1");
    expect(s.focused).toBeNull();
    expect(s.focusBy["3"]).toEqual({ window: "notes", pane: "p1" });
  });

  it("takes a desktop by position too, and does nothing for the same desktop or none", () => {
    expect(moveWindow(desk(), "notes", 3)?.moved.to).toBe("3");
    expect(moveWindow(desk(), "notes", "1")).toBeUndefined();
    expect(moveWindow(desk(), "notes", 9)).toBeUndefined();
    expect(moveWindow(desk(), "missing", "2")).toBeUndefined();
  });

  it("lands where it was before a drag that ended on a desktop", () => {
    const dragged = { ...desk(), session: { "1": layout({ ...notes, x: 1200, y: 10 }) } };
    const s = apply(dragged, moveWindow(dragged, "notes", "2", notes)?.patch);
    expect(layoutOf(s, "2").surfaces[0]).toMatchObject({ x: 200, y: 200, w: 420, h: 360 });
  });

  it("is undone: the window comes back where it was, in use again", () => {
    const result = moveWindow(desk(), "notes", "3");
    if (!result) throw new Error("not moved");
    const moved = apply(desk(), result.patch);
    const back = apply(moved, movedBack(moved, result.moved));
    expect(layoutOf(back, "1").surfaces).toEqual([notes]);
    expect(layoutOf(back, "3").surfaces).toEqual([]);
    expect(back.focused).toBe("notes");
    expect(back.focusBy["3"]).toBeUndefined();
    // Once it is gone from where it went, there is nothing to take back.
    expect(movedBack(back, result.moved)).toBeUndefined();
  });

  it("a plugin window in its slot lives on the desktop it went to, and only there", () => {
    const s0: DeskState = { ...emptyState("en"), adopted: [{ id: "p.term", title: "Terminal" }] };
    expect(on(s0, "1")).toEqual(["p.term"]);
    expect(on(s0, "2")).toEqual(["p.term"]);
    const result = moveWindow(s0, "p.term", "2");
    const s = apply(s0, result?.patch);
    expect(on(s, "1")).toEqual([]);
    expect(on(s, "2")).toEqual(["p.term"]);
    expect(on(s, "4")).toEqual([]);
    expect(holderOf(s, "p.term")).toBe("2");
    // Undone, it is back in its slot on every desktop.
    const back = apply(s, result && movedBack(s, result.moved));
    expect(on(back, "1")).toEqual(["p.term"]);
    expect(on(back, "4")).toEqual(["p.term"]);
  });
});
