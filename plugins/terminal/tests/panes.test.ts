// The terminal's split panes on the SDK's test host (#315): each pane runs its own shell in a PTY,
// a tab holds a layout of them, the focus moves between them by key or press, a divider's drag
// resizes them, and the layout with every pane's folder is kept with store.set and comes back after
// a restart (a fresh shell in each folder) or a reload (the same shells).
import { describe, expect, it } from "vitest";
import { decide } from "../ui/keys.js";
import { mount, scope, store } from "./harness";

const right = (a: string, b: string, ratio = 0.5) => ({
  split: "right",
  ratio,
  a: { pane: a },
  b: { pane: b },
});
const lastLayout = (view: { layouts: Array<{ tab: string; layout: unknown }> }) =>
  view.layouts.at(-1);

describe("split panes", () => {
  it("endue.terminal.split right and down start a shell beside the focused pane, in its folder, in the same tab", async () => {
    const { app, host, view, params } = await mount();
    app.osc("t-1", 7, "file://host/src/app");
    expect(await host.command("endue.terminal.split", { direction: "right" })).toBe("t-2");
    expect(params("proc.spawn")[1]).toMatchObject({ command: "zsh", cwd: "/src/app" });
    expect(lastLayout(view)).toEqual({ tab: "t-1", layout: right("t-1", "t-2") });
    expect(view.shown.at(-1)).toBe("t-2");
    expect(app.tabs()).toHaveLength(1);

    expect(await host.command("endue.terminal.split", { direction: "down" })).toBe("t-3");
    expect(lastLayout(view)).toEqual({
      tab: "t-1",
      layout: {
        split: "right",
        ratio: 0.5,
        a: { pane: "t-1" },
        b: { split: "down", ratio: 0.5, a: { pane: "t-2" }, b: { pane: "t-3" } },
      },
    });
    // A pane named by session splits, whichever is focused.
    expect(await host.command("endue.terminal.split", { direction: "down", session: "t-1" })).toBe(
      "t-4",
    );
    expect(app.tabs()).toHaveLength(1);
    await expect(host.command("endue.terminal.split", { direction: "left" })).rejects.toThrow(
      /right or down/i,
    );
  });

  it("closing a pane ends its shell; closing a tab's last pane closes the tab", async () => {
    const { app, host, view, params, ran } = await mount();
    await host.command("endue.terminal.split", { direction: "right" });
    await host.command("endue.terminal.close");
    expect(params("proc.kill")).toEqual([{ procId: "p2", signal: "hup", scope: scope("zsh") }]);
    expect(view.closed).toEqual(["t-2"]);
    expect(lastLayout(view)).toEqual({ tab: "t-1", layout: { pane: "t-1" } });
    expect(view.shown.at(-1)).toBe("t-1");
    expect(app.tabs()).toHaveLength(1);

    await host.command("endue.terminal.close");
    expect(app.tabs()).toEqual([]);
    expect(ran("desk.buffers.close")).toEqual([
      { id: "endue.terminal:2" },
      { id: "endue.terminal:1" },
    ]);
  });

  it("keys and the pointer move the focus, and the pane in use is marked", async () => {
    const { app, host, view } = await mount();
    await host.command("endue.terminal.split", { direction: "right" });
    await host.command("endue.terminal.split", { direction: "down" });
    expect(app.shown()).toBe("t-3");

    expect(await host.command("endue.terminal.focus-pane", { direction: "left" })).toBe("t-1");
    expect(view.shown.at(-1)).toBe("t-1");
    expect(view.focused.at(-1)).toBe("t-1");
    expect(await host.command("endue.terminal.focus-pane", { direction: "right" })).toBe("t-2");
    expect(await host.command("endue.terminal.focus-pane", { direction: "down" })).toBe("t-3");
    // At an edge it stays.
    expect(await host.command("endue.terminal.focus-pane", { direction: "right" })).toBe("t-3");
    await expect(host.command("endue.terminal.focus-pane", { direction: "in" })).rejects.toThrow(
      /left, right, up or down/i,
    );

    // A press on a pane: the view shows it, so it is the tab's pane in use.
    app.show("t-2");
    expect(view.shown.at(-1)).toBe("t-2");
    expect(app.tabs()).toEqual([
      { id: "t-1", focused: "t-2", layout: expect.objectContaining({ split: "right" }) },
    ]);
  });

  it("dragging a divider sends every pane its new size", async () => {
    const { app, host, view, params } = await mount();
    await host.command("endue.terminal.split", { direction: "right" });
    const before = params("proc.resize").length;
    app.ratio("t-1", "", 0.25, { width: 0.05, height: 0.05 });
    expect(lastLayout(view)).toEqual({ tab: "t-1", layout: right("t-1", "t-2", 0.25) });
    // The view refits each pane to its new box; every PTY whose size changed hears of it.
    app.resize("t-1", 20, 24);
    app.resize("t-2", 60, 24);
    await host.settle();
    expect(params("proc.resize").slice(before)).toEqual([
      { procId: "p1", size: { cols: 20, rows: 24 }, scope: scope("zsh") },
      { procId: "p2", size: { cols: 60, rows: 24 }, scope: scope("zsh") },
    ]);
    // A ratio past the minimum stops at it.
    app.ratio("t-1", "", 0.01, { width: 0.05, height: 0.05 });
    expect(lastLayout(view)).toEqual({ tab: "t-1", layout: right("t-1", "t-2", 0.05) });
  });

  it("the layout and every pane's folder come back after a restart", async () => {
    const kept = store();
    const first = await mount({ handlers: kept.handlers });
    first.app.osc("t-1", 7, "file://host/src");
    await first.host.command("endue.terminal.split", { direction: "right" });
    await first.host.command("endue.terminal.rename", { title: "logs" });
    first.app.osc("t-2", 7, "file://host/var/log");
    await first.settle();
    expect(kept.sets.at(-1)).toEqual({
      key: "layout",
      value: {
        v: 1,
        shown: 0,
        tabs: [
          {
            focused: 1,
            layout: {
              split: "right",
              ratio: 0.5,
              a: { pane: { cwd: "/src", title: "zsh", named: false } },
              b: { pane: { cwd: "/var/log", title: "logs", named: true } },
            },
          },
        ],
      },
    });

    // The app quits: no reload snapshot, only what the store kept.
    const again = await mount({ handlers: store(kept.kept).handlers });
    expect(again.params("proc.spawn")).toMatchObject([
      { command: "zsh", cwd: "/src" },
      { command: "zsh", cwd: "/var/log" },
    ]);
    expect(again.view.opened).toEqual([
      { id: "t-1", title: "zsh" },
      { id: "t-2", title: "logs" },
    ]);
    expect(lastLayout(again.view)).toEqual({ tab: "t-1", layout: right("t-1", "t-2") });
    expect(again.app.shown()).toBe("t-2");
    expect(again.app.tabs()).toHaveLength(1);
  });

  it("a kept layout that does not read starts one terminal, as with none", async () => {
    const { params, app } = await mount({ handlers: store({ layout: { v: 9 } }).handlers });
    expect(params("proc.spawn")).toHaveLength(1);
    expect(app.tabs()).toHaveLength(1);
  });

  it("a reload attaches every pane to its running shell", async () => {
    const first = await mount();
    await first.host.command("endue.terminal.split", { direction: "right" });
    await first.host.command("endue.terminal.new");
    await first.settle();

    const again = await mount({ state: first.host.state, size: { cols: 70, rows: 20 } });
    expect(again.params("proc.spawn")).toEqual([]);
    expect(again.view.layouts).toContainEqual({ tab: "t-1", layout: right("t-1", "t-2") });
    expect(again.params("proc.resize")).toEqual([
      { procId: "p1", size: { cols: 70, rows: 20 }, scope: scope("zsh") },
      { procId: "p2", size: { cols: 70, rows: 20 }, scope: scope("zsh") },
      { procId: "p3", size: { cols: 70, rows: 20 }, scope: scope("zsh") },
    ]);
    expect(again.app.tabs().map((t) => t.id)).toEqual(["t-1", "t-3"]);
    expect(again.app.shown()).toBe("t-3");
    expect(await again.host.command("endue.terminal.split", { direction: "down" })).toBe("t-4");
  });

  it("the split keys never reach the shell", () => {
    const key = (k: string, mods: Record<string, boolean>) => ({
      key: k,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    for (const press of [
      key("\\", { metaKey: true }),
      key("Enter", { metaKey: true, shiftKey: true }),
      key("ArrowLeft", { metaKey: true, shiftKey: true }),
      key("ArrowDown", { metaKey: true, shiftKey: true }),
    ]) {
      expect(decide(press, { platform: "mac" })).toBe("desk");
    }
    for (const platform of ["linux", "windows"] as const) {
      for (const press of [
        key("\\", { ctrlKey: true, altKey: true }),
        key("|", { ctrlKey: true, altKey: true, shiftKey: true }),
        key("ArrowRight", { ctrlKey: true, shiftKey: true }),
        key("ArrowUp", { ctrlKey: true, shiftKey: true }),
      ]) {
        expect(decide(press, { platform })).toBe("desk");
      }
      // Control+\ stays the shell's quit.
      expect(decide(key("\\", { ctrlKey: true }), { platform })).toBe("terminal");
    }
  });
});
