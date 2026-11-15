// desk.windows.find: the palette's Windows group (#304). Every open window, on every desktop and out
// of the canvas, found by its title, its plugin or its desktop's name, each choosing
// desk.windows.focus, which switches desktops first when it has to (focus-desktop.test.ts).
import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { Commands } from "../commands";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import type { Ctx } from "../shell/actions";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import { FOCUS } from "./commands";
import { defineFindWindows, FIND } from "./find";

const TITLES: Record<string, string> = {
  calendar: "Calendar",
  notes: "Meeting notes",
  tomorrow: "Plan for tomorrow",
};
const PLUGINS: Record<string, string> = { "endue.notes": "Notes", "endue.calendar": "Calendar" };

const at = (id: string, plugin: string): SurfacePlacement => ({
  id,
  plugin,
  x: 10,
  y: 20,
  w: 400,
  h: 300,
  pinned: false,
});
const place = (desktop: DesktopId, placement: SurfacePlacement): Edit => ({
  op: "place",
  desktop,
  placement,
});

async function desk() {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const commands = new Commands(new BridgeClient(stub));
  const store = new Store(sampleState("en", 0));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  await wm.edit([
    place("1", at("calendar", "endue.calendar")),
    place("1", at("notes", "endue.notes")),
    place("2", at("tomorrow", "endue.notes")),
    { op: "rename-desktop", desktop: "2", name: "Home" },
  ]);
  const ctx = { store, wm, runtime: { commands } } as unknown as Ctx;
  defineFindWindows(ctx, {
    title: (p) => TITLES[p.id] ?? p.id,
    plugin: (id) => PLUGINS[id] ?? id,
  });
  await commands.settled();
  return { commands };
}

describe("desk.windows.find", () => {
  it("lists the open windows with title, plugin and desktop", async () => {
    const { commands } = await desk();
    expect(await commands.run(FIND, { query: "tomorrow" })).toEqual({
      results: [
        {
          id: "tomorrow",
          title: "Plan for tomorrow",
          detail: "Notes · desktop Home",
          kind: "window",
          actions: [{ command: FOCUS, title: "Switch to window", args: { window: "tomorrow" } }],
        },
      ],
    });
    // By the plugin's name: both Notes windows, the desktop in front first.
    const notes = (await commands.run(FIND, { query: "notes" })) as { results: { id: string }[] };
    expect(notes.results.map((r) => r.id)).toEqual(["notes", "tomorrow"]);
    // By the desktop's name.
    const home = (await commands.run(FIND, { query: "home" })) as { results: { id: string }[] };
    expect(home.results.map((r) => r.id)).toEqual(["tomorrow"]);
    // At most `limit`, and nothing for nothing typed.
    const one = (await commands.run(FIND, { query: "e", limit: 1 })) as { results: unknown[] };
    expect(one.results).toHaveLength(1);
    expect(await commands.run(FIND, { query: "zzz" })).toEqual({ results: [] });
  });
});
