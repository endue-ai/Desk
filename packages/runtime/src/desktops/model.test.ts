import { describe, expect, it } from "vitest";
import type { DesktopLayout, SurfacePlacement } from "../modes/types";
import { desktopsOf, dirty, layoutOf } from "../shell/actions";
import { type DeskState, emptyState } from "../shell/state";
import { added, defaultDesktops, MAX_DESKTOPS, moved, nextId, renamed } from "./model";
import { addDesktop, removeDesktop, renameDesktop, reorderDesktop } from "./ops";

const win = (id: string, x = 100): SurfacePlacement => ({
  id,
  plugin: "endue.notes",
  x,
  y: 120,
  w: 400,
  h: 300,
  pinned: false,
});
const layout = (...surfaces: SurfacePlacement[]): DesktopLayout => ({
  surfaces,
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
});
/** Apply a change the way the store does. */
const apply = (s: DeskState, patch: Partial<DeskState> | undefined): DeskState => ({
  ...s,
  ...patch,
});
const names = (s: DeskState) => desktopsOf(s).map((d) => d.name);
const ids = (s: DeskState) => desktopsOf(s).map((d) => d.id);

describe("desktops are a named, open-ended list", () => {
  it("a fresh desk has four desktops named 1 to 4, and nothing to save", () => {
    const s = emptyState("en");
    expect(desktopsOf(s)).toEqual(defaultDesktops());
    expect(names(s)).toEqual(["1", "2", "3", "4"]);
    expect(dirty(s)).toBe(false);
  });

  it("adds a desktop at the end with a fresh id and the first free number as its name", () => {
    let s = emptyState("en");
    const next = addDesktop(s);
    s = apply(s, next?.patch);
    expect(next?.id).toBe("5");
    expect(names(s)).toEqual(["1", "2", "3", "4", "5"]);
    s = apply(s, addDesktop(s, "  Research   notes ")?.patch);
    expect(desktopsOf(s)[5]).toEqual({ id: "6", name: "Research notes" });
    // The added desktops are a change to the profile, until it is saved or reverted.
    expect(dirty(s)).toBe(true);
  });

  it("renames, and an empty name keeps the old one", () => {
    let s = emptyState("en");
    s = apply(s, renameDesktop(s, 2, "Mail"));
    expect(names(s)).toEqual(["1", "Mail", "3", "4"]);
    s = apply(s, renameDesktop(s, "2", "   "));
    expect(names(s)).toEqual(["1", "Mail", "3", "4"]);
    expect(renamed(defaultDesktops(), "1", "x".repeat(80))[0]?.name).toHaveLength(40);
  });

  it("reorders by id: the id stays with the desktop, the index is its new position", () => {
    let s: DeskState = { ...emptyState("en"), session: { "3": layout(win("notes")) } };
    s = apply(s, reorderDesktop(s, "3", 1));
    expect(ids(s)).toEqual(["3", "1", "2", "4"]);
    expect(layoutOf(s, 1).surfaces.map((p) => p.id)).toEqual(["notes"]);
    expect(moved(defaultDesktops(), "1", 99).map((d) => d.id)).toEqual(["2", "3", "4", "1"]);
    // Back in the profile's order: nothing left to save.
    s = apply(s, reorderDesktop(s, "3", 3));
    expect(s.desktops).toBeNull();
  });

  it("removing a desktop moves its windows to the one before it, at the same place on screen", () => {
    let s: DeskState = {
      ...emptyState("en"),
      desktop: "3",
      session: { "2": layout(win("mail", 40)), "3": layout(win("notes", 300)) },
      pan: { "2": { x: 0, y: 0 }, "3": { x: -200, y: 0 } },
    };
    const removal = removeDesktop(s, "3", "move");
    s = apply(s, removal?.patch);
    expect(removal?.into).toBe("2");
    expect(ids(s)).toEqual(["1", "2", "4"]);
    expect(s.desktop).toBe("2");
    // 300 on a canvas panned by -200 sat at 100 on screen; desktop 2 is not panned.
    expect(layoutOf(s, "2").surfaces.map((p) => [p.id, p.x])).toEqual([
      ["mail", 40],
      ["notes", 100],
    ]);
    expect(s.session["3"]).toBeUndefined();
    expect(s.pan["3"]).toBeUndefined();
  });

  it("removing the first desktop sends its windows to the next; closing them drops them", () => {
    const s: DeskState = { ...emptyState("en"), session: { "1": layout(win("notes")) } };
    expect(removeDesktop(s, "1", "move")?.into).toBe("2");
    const closed = removeDesktop(s, "1", "close");
    expect(closed?.closed.map((p) => p.id)).toEqual(["notes"]);
    expect(layoutOf(apply(s, closed?.patch), "2").surfaces).toEqual([]);
  });

  it("keeps the last desktop", () => {
    let s = emptyState("en");
    for (const id of ["1", "2", "3"]) s = apply(s, removeDesktop(s, id, "close")?.patch);
    expect(ids(s)).toEqual(["4"]);
    expect(removeDesktop(s, "4", "close")).toBeUndefined();
  });

  it("stops at 32 desktops", () => {
    let s = emptyState("en");
    while (addDesktop(s)) s = apply(s, addDesktop(s)?.patch);
    expect(desktopsOf(s)).toHaveLength(MAX_DESKTOPS);
    expect(added(desktopsOf(s), [])).toBeUndefined();
  });

  it("never gives a new desktop the id of one a layout still names", () => {
    expect(nextId(["1", "2", "3", "4", "7"])).toBe("8");
    let s: DeskState = { ...emptyState("en"), session: { "4": layout(win("notes")) } };
    s = apply(s, removeDesktop(s, "4", "close")?.patch);
    s = { ...s, pan: { "9": { x: 1, y: 1 } } };
    expect(addDesktop(s)?.id).toBe("10");
  });

  it("every desktop keeps its own layout and pan", () => {
    let s: DeskState = {
      ...emptyState("en"),
      session: { "1": layout(win("a")), "2": layout(win("b")) },
      pan: { "1": { x: -50, y: 0 }, "2": { x: 0, y: -80 } },
    };
    const next = addDesktop(s, "Six");
    s = apply(s, next?.patch);
    s = { ...s, session: { ...s.session, [next?.id ?? ""]: layout(win("c")) } };
    s = apply(s, reorderDesktop(s, next?.id ?? "", 1));
    expect(desktopsOf(s).map((d) => [d.name, layoutOf(s, d.id).surfaces.map((p) => p.id)])).toEqual(
      [
        ["Six", ["c"]],
        ["1", ["a"]],
        ["2", ["b"]],
        ["3", []],
        ["4", []],
      ],
    );
    expect(s.pan["1"]).toEqual({ x: -50, y: 0 });
    expect(s.pan["2"]).toEqual({ x: 0, y: -80 });
  });
});
