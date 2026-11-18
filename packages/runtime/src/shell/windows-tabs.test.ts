// A window's tabs on the runtime's side (ADR 0268): a new tab opens another window of the window's
// plugin (ADR 0212) and tells desk-wm of the tab first, stepping shows the tab beside, and closing
// a tab unmounts its plugin's window alone. Which tabs a window takes is desk-wm's
// (crates/desk-wm/tests/tabs.rs).
import { describe, expect, it, vi } from "vitest";
import { Buffers } from "../buffers";
import { tabsOf } from "../surface/tree";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { settled, windowsOf } from "./actions";
import { Store, sampleState } from "./state";
import { closeTab, focusTab, newTab, newWindow, stepTab } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

/** The shell over desk-wm, with plugins `p.a` and `p.b` handed over in slots 0 and 1. */
async function ctx() {
  const wm = testWindowManager();
  const store = new Store(sampleState("en", epoch));
  wm.connect((published) => takeDesk(store, published));
  const shortcuts = { focused: null as string | null };
  const focusSurface = vi.fn((id: string | null) => {
    shortcuts.focused = id;
  });
  const unmount = vi.fn((id: string) => void wm.edit([{ op: "release", id }]));
  // As the plugin host opens another window of a plugin: its key is told first, then its surface
  // is handed over.
  const opened = new Map<string, number>();
  const another = vi.fn((plugin: string, before?: (key: string) => void) => {
    const n = (opened.get(plugin) ?? 1) + 1;
    opened.set(plugin, n);
    const key = `${plugin}@${n}`;
    before?.(key);
    void wm.edit([{ op: "adopt", id: key, title: key }]);
    return key;
  });
  await wm.edit(["p.a", "p.b"].map((id) => ({ op: "adopt", id, title: id })));
  return {
    store,
    wm,
    unmount,
    another,
    shortcuts,
    runtime: {
      shortcuts,
      focusSurface,
      followSurface: focusSurface,
      plugins: { unmount, another },
      buffers: new Buffers(),
    } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

describe("a window's tabs (ADR 0268)", () => {
  const tabs = (c: Awaited<ReturnType<typeof ctx>>, id: string) => {
    const window = windowsOf(c.store.get()).find((p) => p.id === id);
    return window ? tabsOf(window).map((t) => t.view) : [];
  };

  it("a new tab is another window of the window's plugin, in that window", async () => {
    const c = await ctx();
    await focusTab(c, "p.a");
    expect(await newTab(c)).toBe("p2");
    await settled(c);
    expect(c.another).toHaveBeenCalledWith("p.a", expect.any(Function));
    const s = c.store.get();
    expect(tabs(c, "p.a")).toEqual(["plugin:p.a", "plugin:p.a@2"]);
    // The plugin's second window is that tab: it never has a window of its own.
    expect(windowsOf(s).map((p) => p.id)).not.toContain("p.a@2");
    expect([s.focused, s.tab, s.wm.focusedPlugin]).toEqual(["p.a", "p2", "p.a@2"]);
  });

  it("a window named, not the one in use, takes the tab", async () => {
    const c = await ctx();
    await focusTab(c, "p.a");
    await newTab(c, "p.b");
    await settled(c);
    expect(tabs(c, "p.b")).toEqual(["plugin:p.b", "plugin:p.b@2"]);
    expect(tabs(c, "p.a")).toEqual(["plugin:p.a"]);
  });

  it("a window of the shell's own view takes no tab, and no plugin opens a window for it", async () => {
    const c = await ctx();
    const id = await newWindow(c);
    expect(await newTab(c)).toBeUndefined();
    expect(c.another).not.toHaveBeenCalled();
    expect(tabs(c, id)).toEqual(["launcher"]);
  });

  it("stepping shows the tab beside, whose plugin takes the keys", async () => {
    const c = await ctx();
    await focusTab(c, "p.a");
    await newTab(c);
    await settled(c);
    await stepTab(c, 1);
    expect(c.store.get().tab).toBe("p1");
    expect(c.shortcuts.focused).toBe("p.a");
    await stepTab(c, -1);
    expect(c.store.get().tab).toBe("p2");
    expect(c.shortcuts.focused).toBe("p.a@2");
  });

  it("closing a tab unmounts its plugin's window alone, and the window shows the one left", async () => {
    const c = await ctx();
    await focusTab(c, "p.a");
    await newTab(c);
    await settled(c);
    await closeTab(c, "p.a", "p1");
    expect(c.unmount).toHaveBeenCalledWith("p.a");
    expect(c.unmount).toHaveBeenCalledTimes(1);
    expect(tabs(c, "p.a")).toEqual(["plugin:p.a@2"]);
    expect(c.store.get().wm.focusedPlugin).toBe("p.a@2");
  });
});
