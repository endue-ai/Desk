// One scene, two sides of the seam (#82, #83): crates/desk-wm builds it from its `Desk`
// (`tests/scene.rs`), and the runtime (this one) builds it with the shell's actions and the edits
// they send to desk-wm as WebAssembly, telling it the titles of its own views and how each frame
// is doing. Both snapshots must equal the contract's vector `desk-windows-list-scene.json`
// (specs/bridge/v0, target BrainDesk): every window's rect in whole pixels, its stacking rank,
// state, fill, pin, focus, desktop and panes, and the desktops with their pans. Change a step here
// and in scene.rs together. A snap and a maximize are window commands (ADR 0153), which desk-wm
// runs itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { edit, openSurface, setDesktop, stash, togglePin } from "./actions";
import { deskSnapshot } from "./desk-view";
import { Store, sampleState } from "./state";
import { focusPane, newWindow, splitPane, toggleFloating } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
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

async function scene() {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const wm = testWindowManager({ w: 1440, h: 900 });
  wm.connect((published) => takeDesk(store, published));
  const frames = {
    state: (id: string) => STATES[id] ?? "responding",
    asleep: (id: string) => ASLEEP.has(id),
  };
  const c = {
    store,
    wm,
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
  await edit(c, ...plugins.map(([id = "", title = ""]) => ({ op: "adopt" as const, id, title })));
  await edit(
    c,
    { op: "set-geometry", geometry: { id: "endue.notes", x: 40, y: 60, w: 600, h: 400 } },
    { op: "set-geometry", geometry: { id: "endue.git", x: 700, y: 60, w: 680, h: 760 } },
  );
  await toggleFloating(c, "endue.notes");
  wm.run({ op: "snap", fill: "right" }, "endue.mail");
  await togglePin(c, "endue.git");
  const one = await newWindow(c);
  await splitPane(c, "row");
  const two = await newWindow(c);
  wm.run({ op: "maximize" }, two);
  await stash(c, "e2e.hello", "Hello");
  // A shell view on desktop 2, its canvas panned; then back to desktop 1, panned too.
  await setDesktop(c, "2");
  await openSurface(c, "calendar");
  await edit(c, { op: "pan", to: { x: -100, y: 50 } });
  await setDesktop(c, "1");
  await edit(c, { op: "pan", to: { x: 30.5, y: -20.4 } });
  await focusPane(c, one, "p1");
  return c;
}

describe("the scene both sides answer (#82)", () => {
  it("is the contract's vector, window for window", async () => {
    const vector = JSON.parse(readFileSync(VECTOR, "utf8")) as {
      target: string;
      instance: { windows: unknown[] };
    };
    expect(vector.target).toBe("BrainDesk");
    const { screen, windows, desktops } = await deskSnapshot(await scene());
    // One window at a time first, so a difference names its window.
    windows.forEach((w, i) => {
      expect(w).toEqual(vector.instance.windows[i]);
    });
    expect({ screen, windows, desktops }).toEqual(vector.instance);
  });
});
