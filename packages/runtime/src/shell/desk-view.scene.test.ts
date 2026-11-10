// One scene, two window managers (#82): the runtime's (this one, over the shell's store) and
// crates/desk-wm's (`tests/scene.rs`, over its `Desk`) build the same desk with the same steps, and
// both snapshots must equal the contract's vector `desk-windows-list-scene.json` (specs/bridge/v0,
// target BrainDesk): every window's rect in whole pixels, its stacking rank, state, fill, pin, focus,
// desktop and panes, and the desktops with their pans. Change a step here and in scene.rs together.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moveSurface, openSurface, setDesktop, stash, togglePin } from "./actions";
import { deskSnapshot } from "./desk-view";
import { Store, sampleState } from "./state";
import { focusPane, newWindow, snapTo, splitPane, toggleFloating, toggleMaximize } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const SIZE = { vw: 1440, vh: 900 };
const VECTOR = join(
  import.meta.dirname,
  "../../../../specs/bridge/v0/vectors/valid/desk-windows-list-scene.json",
);

/** How each plugin's frame is doing in the scene: Notes late, Mail asleep, Git stopped. */
const STATES: Record<string, "late" | "stopped"> = {
  "endue.notes": "late",
  "endue.git": "stopped",
};
const ASLEEP = new Set(["endue.mail", "endue.git"]);

function scene() {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const frames = {
    state: (id: string) => STATES[id] ?? "responding",
    asleep: (id: string) => ASLEEP.has(id),
  };
  const c = {
    store,
    runtime: {
      shortcuts: { focused: null },
      focusSurface() {},
      plugins: { unmount() {} },
      frames,
    } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
  // Four plugin windows handed over, in slots 0 to 3.
  const plugins = [
    ["endue.git", "Git"],
    ["endue.notes", "Notes"],
    ["endue.mail", "Mail"],
    ["e2e.hello", "Hello"],
  ];
  store.set({ adopted: plugins.map(([id = "", title = ""], slot) => ({ id, title, slot })) });
  moveSurface(c, "endue.notes", { x: 40, y: 60, w: 600, h: 400 });
  moveSurface(c, "endue.git", { x: 700, y: 60, w: 680, h: 760 });
  toggleFloating(c, "endue.notes", SIZE);
  snapTo(c, "endue.mail", "right");
  togglePin(c, "endue.git");
  const one = newWindow(c);
  splitPane(c, "row");
  const two = newWindow(c);
  toggleMaximize(c, two);
  stash(c, "e2e.hello", "Hello");
  // A shell view on desktop 2, its canvas panned; then back to desktop 1, panned too.
  setDesktop(c, "2");
  openSurface(c, "calendar");
  store.set((s) => ({ pan: { ...s.pan, "2": { x: -100, y: 50 } } }));
  setDesktop(c, "1");
  store.set((s) => ({ pan: { ...s.pan, "1": { x: 30.5, y: -20.4 } } }));
  focusPane(c, one, "p1");
  return c;
}

describe("the scene both window managers answer (#82)", () => {
  it("is the contract's vector, window for window", () => {
    const vector = JSON.parse(readFileSync(VECTOR, "utf8")) as {
      target: string;
      instance: unknown;
    };
    expect(vector.target).toBe("BrainDesk");
    const { screen, windows, desktops } = deskSnapshot(scene(), SIZE);
    expect({ screen, windows, desktops }).toEqual(vector.instance);
  });
});
