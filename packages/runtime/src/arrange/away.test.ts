// desk.windows.put-away (issue 280) on the bridge stub's core over desk-wm as WebAssembly: the
// window in use, or the one named, goes into the drawer under the title its title bar shows and
// comes back from there; a window that is not on the desktop in front is refused with the desk's
// words. The title bar draws no tool for it (`surface/Surface.ts`): this command is the way.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeClient, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { Commands } from "../commands";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { edit, raise, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { type CopyKey, t } from "../shell/copy";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import { defineAwayCommand, PUT_AWAY } from "./away";

const epoch = Date.parse("2026-11-15T09:00:00.000Z");

const at = (id: string, x: number, more: Partial<SurfacePlacement> = {}): SurfacePlacement => ({
  id,
  plugin: `endue.${id}`,
  x,
  y: 200,
  w: 400,
  h: 300,
  pinned: false,
  ...more,
});
const place = (desktop: DesktopId, placement: SurfacePlacement): Edit => ({
  op: "place",
  desktop,
  placement,
});

async function desk() {
  const registry = stubCommands((event) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const commands = new Commands(new BridgeClient(stub));
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const split = {
    kind: "split" as const,
    id: "s1",
    dir: "row" as const,
    ratio: 0.5,
    a: { kind: "view" as const, id: "p1", view: "notes" },
    b: { kind: "view" as const, id: "p2", view: "calendar" },
  };
  const ctx = {
    store,
    wm,
    runtime: { commands, shortcuts: { focused: null } },
    wall: () => epoch + 1000,
    tr: (key: CopyKey, vars?: Record<string, string | number>) => t("en", key, vars),
  } as unknown as ShellCtx;
  await edit(ctx, { op: "adopt", id: "endue.mail", title: "Mail" });
  await wm.edit([
    place("1", at("endue.mail", 300, { plugin: "endue.mail" })),
    place("1", at("window-1", 800, { panes: split })),
    place("2", at("tomorrow", 700)),
    { op: "focus", window: "endue.mail" },
  ]);
  defineAwayCommand(ctx);
  await commands.settled();
  return { store, commands, ctx };
}

const here = (store: Store) => windowsOf(store.get()).map((p) => p.id);
const away = (store: Store) => store.get().drawer.map((d) => [d.id, d.name, d.kind]);

describe("desk.windows.put-away", () => {
  it("puts the window in use in the drawer under its title, and the drawer brings it back", async () => {
    const { commands, store, ctx } = await desk();
    expect(await commands.run(PUT_AWAY, {})).toEqual({ window: "endue.mail", name: "Mail" });
    expect(here(store)).not.toContain("endue.mail");
    expect(away(store)).toEqual([["surface-endue.mail", "Mail", "surface"]]);
    expect(store.get().drawer[0]?.at).toBe(epoch + 1000);
    await raise(ctx, "surface-endue.mail");
    expect(here(store)).toContain("endue.mail");
    expect(away(store)).toEqual([]);
  });

  it("puts a named window away with its panes, under the title of its first pane", async () => {
    const { commands, store } = await desk();
    expect(await commands.run(PUT_AWAY, { window: "window-1" })).toEqual({
      window: "window-1",
      name: "Notes",
    });
    expect(here(store)).toEqual(["endue.mail"]);
    const [item] = store.get().drawer;
    expect(item?.placement?.panes).toMatchObject({ kind: "split" });
  });

  it("refuses a window that is not on the desktop in front, and has nothing to put away on an empty one", async () => {
    const { commands, store } = await desk();
    await expect(commands.run(PUT_AWAY, { window: "tomorrow" })).rejects.toThrow(
      /not on this desktop/,
    );
    await expect(commands.run(PUT_AWAY, { window: "nowhere" })).rejects.toThrow(
      /not on this desktop/,
    );
    await commands.run(PUT_AWAY, {});
    await commands.run(PUT_AWAY, { window: "window-1" });
    // Nothing left on the desktop in front: there is no window to put away.
    expect(here(store)).toEqual([]);
    await expect(commands.run(PUT_AWAY, {})).rejects.toThrow(/not on this desktop|say which/);
    expect(away(store).map(([id]) => id)).toEqual(["surface-window-1", "surface-endue.mail"]);
  });

  it("is the way: a window's title bar draws no tool that puts it away", () => {
    const surface = readFileSync(join(import.meta.dirname, "../surface/Surface.ts"), "utf8");
    const tools = surface.slice(surface.indexOf('class: "surface-tools"'));
    expect(tools.slice(0, tools.indexOf('h("div", { class: "surface-body" })'))).not.toMatch(
      /stash|"drawer"/,
    );
  });
});
