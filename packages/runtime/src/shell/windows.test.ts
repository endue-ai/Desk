// The runtime's side of the windows (#83): which window a pane is in, where it goes and what a close
// leaves are desk-wm's (crates/desk-wm/tests/desk.rs, panes.rs, tiling.rs, fill.rs, cover.rs);
// what stays here is the runtime's surfaces following the pane in use, the plugins a close
// unmounts for the session (ADR 0040) and the question about their unsaved changes before (#160).
import { describe, expect, it, vi } from "vitest";
import { Buffers } from "../buffers";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { openSurface } from "./actions";
import { Store, sampleState } from "./state";
import {
  closePane,
  closeWindow,
  focusPane,
  newWindow,
  showInPane,
  showPlugin,
  splitPane,
} from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

/** The shell over desk-wm, with plugins `p.a`, `p.b` and `p.c` handed over in slots 0 to 2. */
async function ctx() {
  const store = new Store(sampleState("en", epoch));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const shortcuts = { focused: null as string | null };
  const focusSurface = vi.fn((id: string | null) => {
    shortcuts.focused = id;
  });
  const unmount = vi.fn((id: string) => void wm.edit([{ op: "release", id }]));
  await wm.edit(["p.a", "p.b", "p.c"].map((id) => ({ op: "adopt", id, title: id })));
  const buffers = new Buffers();
  return {
    store,
    wm,
    unmount,
    focusSurface,
    shortcuts,
    buffers,
    runtime: { shortcuts, focusSurface, plugins: { unmount }, buffers } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

describe("the runtime's surfaces follow the pane in use", () => {
  it("a plugin's pane takes the keys, and a pane of the shell's own takes them from the plugins", async () => {
    const c = await ctx();
    await showPlugin(c, "p.a");
    expect(c.store.get().focused).toBe("p.a");
    expect(c.focusSurface).toHaveBeenLastCalledWith("p.a");
    // ⌘N answers the id desk-wm gave its window, whose launcher takes the keys from the plugins.
    const id = await newWindow(c);
    expect(c.store.get().focused).toBe(id);
    expect(c.focusSurface).toHaveBeenLastCalledWith(null);
    await focusPane(c, "p.b");
    expect(c.focusSurface).toHaveBeenLastCalledWith("p.b");
    expect(c.shortcuts.focused).toBe("p.b");
  });

  it("a pane already in use is not focused again, and the surfaces still follow it", async () => {
    const c = await ctx();
    await focusPane(c, "p.a");
    const edit = vi.spyOn(c.wm, "edit");
    c.shortcuts.focused = null;
    await focusPane(c, "p.a");
    expect(edit).not.toHaveBeenCalled();
    expect(c.shortcuts.focused).toBe("p.a");
  });

  it("a plugin shown in a pane of the shell's window takes the keys there", async () => {
    const c = await ctx();
    const id = await newWindow(c);
    expect(c.shortcuts.focused).toBeNull();
    await showInPane(c, id, "p1", "plugin:p.a");
    expect(c.store.get().focused).toBe(id);
    expect(c.shortcuts.focused).toBe("p.a");
  });
});

describe("closing a window", () => {
  it("unmounts the plugins it showed for the session", async () => {
    const c = await ctx();
    await closeWindow(c, "p.b");
    expect(c.unmount).toHaveBeenCalledWith("p.b");
    expect(c.store.get().adopted.map((a) => a.id)).toEqual(["p.a", "p.c"]);
  });

  it("closes a shell view's window without unmounting anything", async () => {
    const c = await ctx();
    await openSurface(c, "calendar");
    await closeWindow(c, "calendar");
    expect(c.unmount).not.toHaveBeenCalled();
  });

  it("the last pane of a plugin's window closes it, and its plugin unmounts", async () => {
    const c = await ctx();
    await focusPane(c, "p.c");
    await closePane(c);
    expect(c.unmount).toHaveBeenCalledWith("p.c");
    expect(c.unmount).toHaveBeenCalledTimes(1);
  });
});

describe("closing a window with unsaved changes (#160, #162)", () => {
  const unsaved = (c: Awaited<ReturnType<typeof ctx>>, plugin: string) => {
    c.buffers.add({ id: `${plugin}:1`, name: "a.md", plugin, modified: true, surface: false });
    const guard = vi.fn(async () => false);
    c.buffers.guard(guard);
    return guard;
  };

  it("asks about the buffers of the plugins it shows first; kept, the window stays", async () => {
    const c = await ctx();
    const guard = unsaved(c, "p.b");
    await closeWindow(c, "p.b");
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({
        leaving: "close",
        buffers: [expect.objectContaining({ plugin: "p.b" })],
      }),
    );
    expect(c.unmount).not.toHaveBeenCalled();
    expect(c.store.get().adopted.map((a) => a.id)).toEqual(["p.a", "p.b", "p.c"]);
    guard.mockResolvedValue(true);
    await closeWindow(c, "p.b");
    expect(c.unmount).toHaveBeenCalledWith("p.b");
  });

  it("asks when the last pane closes the window, and not for one pane of a split", async () => {
    const c = await ctx();
    const guard = unsaved(c, "p.c");
    await focusPane(c, "p.c");
    await closePane(c);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(c.unmount).not.toHaveBeenCalled();
    await splitPane(c, "row");
    await closePane(c);
    expect(guard).toHaveBeenCalledTimes(1);
  });
});
