import { describe, expect, it } from "vitest";
import type { BrainDesk, BrainDeskWindow } from "../../../packages/bridge/src/index";
import { bringsForward } from "../ui/front.js";

const win = (plugin: string, extra: Partial<BrainDeskWindow> = {}): BrainDeskWindow => ({
  id: plugin,
  x: 100,
  y: 100,
  w: 400,
  h: 300,
  state: "normal",
  desktop: "1",
  panes: [{ id: "p1", view: `plugin:${plugin}`, plugin }],
  ...extra,
});

/** The desk with these windows, front to back as desk.windows.list lists them, on desktop 1. */
const desk = (...windows: BrainDeskWindow[]): BrainDesk => ({
  screen: { w: 1280, h: 800 },
  windows,
  desktops: [
    { id: "1", name: "1", current: true },
    { id: "2", name: "2" },
  ],
});

describe("a tile of a plugin that is on", () => {
  it("brings forward a window under another, and puts away the one above every other", () => {
    const now = desk(win("example.notes", { z: 1 }), win("example.mail", { z: 0 }));
    expect(bringsForward(now, "example.mail")).toBe(true);
    expect(bringsForward(now, "example.notes")).toBe(false);
  });

  it("puts away the window in use too, also under a window that floats", () => {
    const now = desk(
      win("example.clock", { z: 1, state: "floating", floating: true }),
      win("example.notes", { z: 0, focused: true }),
    );
    expect(bringsForward(now, "example.notes")).toBe(false);
    expect(bringsForward(now, "example.clock")).toBe(false);
  });

  it("goes by z, then by the list's front-to-back order where z is absent", () => {
    const stacked = desk(win("a.under", { z: 0 }), win("a.over", { z: 2 }));
    expect(bringsForward(stacked, "a.under")).toBe(true);
    expect(bringsForward(stacked, "a.over")).toBe(false);
    const listed = desk(win("a.first"), win("a.second"));
    expect(bringsForward(listed, "a.first")).toBe(false);
    expect(bringsForward(listed, "a.second")).toBe(true);
  });

  it("brings a window back from the drawer or another desktop", () => {
    const drawer = desk(win("example.notes", { hidden: true, desktop: undefined }));
    expect(bringsForward(drawer, "example.notes")).toBe(true);
    const elsewhere = desk(
      win("example.notes", { z: 3, desktop: "2", focused: true }),
      win("example.mail", { z: 0 }),
    );
    expect(bringsForward(elsewhere, "example.notes")).toBe(true);
    expect(bringsForward(elsewhere, "example.mail")).toBe(false);
  });

  it("puts away a plugin that shows in no window, as a closed one", () => {
    expect(bringsForward(desk(win("example.mail", { z: 0 })), "example.notes")).toBe(false);
    expect(bringsForward(desk(), "example.notes")).toBe(false);
  });

  it("counts every pane of a split window", () => {
    const split = win("window-1", {
      z: 0,
      panes: [
        { id: "p1", view: "plugin:example.mail", plugin: "example.mail" },
        { id: "p2", view: "plugin:example.notes", plugin: "example.notes" },
      ],
    });
    const now = desk(win("example.clock", { z: 1 }), split);
    expect(bringsForward(now, "example.notes")).toBe(true);
    expect(bringsForward(desk(split), "example.notes")).toBe(false);
  });

  it("takes every window as on screen from a desk that names no desktops", () => {
    const old: BrainDesk = {
      screen: { w: 1280, h: 800 },
      windows: [win("example.notes", { desktop: undefined }), win("example.mail")],
    };
    expect(bringsForward(old, "example.notes")).toBe(false);
    expect(bringsForward(old, "example.mail")).toBe(true);
  });
});
