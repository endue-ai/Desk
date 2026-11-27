// The rest of a window's functions for agents (ADR 0269) over desk-wm as WebAssembly: float it
// and put it back on the canvas, pin it, bring it back from the drawer, move it to another desktop
// or a new one, open a new window, split a pane and close one. Asking for the state a window is in
// already changes nothing (no toggle), and each answers what the desk did.
import { describe, expect, it } from "vitest";
import { edit, stash, windowsOf } from "../shell/actions";
import { tabsOf } from "../surface/tree";
import { BRING_BACK, CLOSE_TAB, FLOAT, MOVE_TO_DESKTOP, NEW, NEW_TAB, PIN } from "./control";
import { windowDesk as desk, drawn, placed } from "./control-fixtures";

describe("desk.windows.float", () => {
  it("floats a window where it is on screen and puts it back on the canvas", async () => {
    const { commands, store } = await desk();
    expect(await commands.run(FLOAT, { window: "notes", floating: true })).toMatchObject({
      x: 300,
      y: 200,
      state: "floating",
      floating: true,
    });
    expect(placed(store, "notes")?.floating).toBe(true);
    // Already floating: nothing changes.
    expect(await commands.run(FLOAT, { window: "notes", floating: true })).toMatchObject({
      floating: true,
    });
    expect(await commands.run(FLOAT, { window: "notes", floating: false })).toMatchObject({
      x: 300,
      y: 200,
      state: "normal",
      floating: false,
    });
  });

  it("puts a snapped window on the canvas out of its fill", async () => {
    const { commands, store } = await desk();
    expect(await commands.run(FLOAT, { window: "calendar", floating: false })).toMatchObject({
      state: "normal",
      floating: false,
    });
    expect(placed(store, "calendar")?.fill).toBeUndefined();
    await expect(commands.run(FLOAT, { window: "notes" })).rejects.toThrow(/true or false/);
  });
});

describe("desk.windows.pin", () => {
  it("pins and unpins, and asking twice changes nothing", async () => {
    const { commands, store } = await desk();
    expect(await commands.run(PIN, { window: "notes", pinned: true })).toMatchObject({
      pinned: true,
    });
    expect(await commands.run(PIN, { window: "notes", pinned: true })).toMatchObject({
      pinned: true,
    });
    expect(placed(store, "notes")?.pinned).toBe(true);
    expect(await commands.run(PIN, { pinned: false })).toMatchObject({
      window: "notes",
      pinned: false,
    });
  });
});

describe("desk.windows.bring-back", () => {
  it("brings a window put away in the drawer back where it was", async () => {
    const { commands, store, ctx } = await desk();
    await stash(ctx, "notes", "Notes");
    expect(placed(store, "notes")).toBeUndefined();
    expect(await commands.run(BRING_BACK, { window: "notes" })).toMatchObject({
      window: "notes",
      x: 300,
      y: 200,
      w: 400,
      h: 300,
    });
    expect(store.get().drawer).toEqual([]);
  });

  it("refuses a window that is not in the drawer", async () => {
    const { commands } = await desk();
    await expect(commands.run(BRING_BACK, { window: "notes" })).rejects.toThrow(
      /not in the drawer/,
    );
  });
});

describe("desk.windows.move-to-desktop", () => {
  it("moves a window to a desktop by id, by name and by position, the one in front staying", async () => {
    const { commands, store, ctx } = await desk();
    expect(await commands.run(MOVE_TO_DESKTOP, { window: "notes", desktop: "3" })).toEqual({
      window: "notes",
      moved: true,
      desktop: "3",
    });
    expect(placed(store, "notes", "3")).toBeDefined();
    expect(store.get().desktop).toBe("1");
    await edit(ctx, { op: "rename-desktop", desktop: "2", name: "Work" });
    expect(await commands.run(MOVE_TO_DESKTOP, { window: "notes", desktop: "work" })).toMatchObject(
      { moved: true, desktop: "2" },
    );
    expect(await commands.run(MOVE_TO_DESKTOP, { window: "notes", desktop: 4 })).toMatchObject({
      moved: true,
      desktop: "4",
    });
    expect(windowsOf(store.get(), "4").map((p) => p.id)).toContain("notes");
  });

  it("moves a window to a new desktop, and refuses one the desk does not have", async () => {
    const { commands, store } = await desk();
    const before = store.get().wm.desktops.length;
    const moved = (await commands.run(MOVE_TO_DESKTOP, {
      window: "reference",
      desktop: "new",
    })) as { moved: boolean; desktop: string };
    expect(moved.moved).toBe(true);
    expect(store.get().wm.desktops).toHaveLength(before + 1);
    expect(placed(store, "reference", moved.desktop)).toBeDefined();
    await expect(
      commands.run(MOVE_TO_DESKTOP, { window: "notes", desktop: "Nowhere" }),
    ).rejects.toThrow(/No desktop Nowhere/);
  });
});

describe("desk.windows.new, new-tab and close-tab", () => {
  it("opens a new window in use and answers where it is", async () => {
    const { commands, store } = await desk();
    const frame = (await commands.run(NEW, {})) as { window: string; w: number };
    expect(frame.window).toMatch(/^window-\d+$/);
    expect(frame.w).toBeGreaterThan(0);
    expect(store.get().focused).toBe(frame.window);
    expect(drawn(store, frame.window)).toBeDefined();
  });

  it("opens a tab of the window's own plugin, then closes it (ADR 0270)", async () => {
    const { commands, store, wm, ctx } = await desk();
    // As the plugin host opens another window of a plugin: its key is told first, then its
    // surface is handed over.
    const another = (plugin: string, before?: (key: string) => void) => {
      const key = `${plugin}@2`;
      before?.(key);
      void wm.edit([{ op: "adopt", id: key, title: key }]);
      return key;
    };
    (ctx.runtime as unknown as { plugins: object }).plugins = { unmount() {}, another };
    await wm.edit([{ op: "adopt", id: "endue.notes", title: "Notes" }]);
    const tabs = () => tabsOf(placed(store, "notes") ?? { id: "notes" });
    const opened = (await commands.run(NEW_TAB, { window: "notes" })) as {
      window: string;
      tab: string;
    };
    expect(opened.window).toBe("notes");
    expect(tabs().map((t) => t.view)).toEqual(["notes", "plugin:endue.notes@2"]);
    expect(tabs().map((t) => t.id)).toContain(opened.tab);
    expect(await commands.run(CLOSE_TAB, { window: "notes", tab: opened.tab })).toEqual({
      window: "notes",
      tab: opened.tab,
      closed: true,
      windowClosed: false,
    });
    expect(tabs()).toHaveLength(1);
    await expect(commands.run(CLOSE_TAB, { window: "notes", tab: "p9" })).rejects.toThrow(
      /no such tab/,
    );
  });

  it("a window of the shell's own view takes no tab", async () => {
    const { commands } = await desk();
    const { window } = (await commands.run(NEW, {})) as { window: string };
    await expect(commands.run(NEW_TAB, { window })).rejects.toThrow(/takes no tab/);
  });

  it("closing a window's last tab closes it unless the person keeps unsaved changes", async () => {
    const kept = await desk(() => Promise.resolve(false));
    const only = tabsOf(placed(kept.store, "notes") ?? { id: "notes" })[0]?.id ?? "";
    expect(await kept.commands.run(CLOSE_TAB, { window: "notes", tab: only })).toMatchObject({
      closed: false,
      windowClosed: false,
    });
    const gone = await desk();
    expect(await gone.commands.run(CLOSE_TAB, { window: "notes", tab: only })).toMatchObject({
      closed: true,
      windowClosed: true,
    });
    expect(placed(gone.store, "notes")).toBeUndefined();
  });
});
