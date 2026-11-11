// The runtime's side of the windows (#83): which window a pane is in, where it goes and what a close
// leaves are desk-wm's (crates/desk-wm/tests/desk.rs, panes.rs, tiling.rs, fill.rs, cover.rs);
// what stays here is the runtime's surfaces following the pane in use, the plugins a close
// unmounts for the session (ADR 0040) and the question about their unsaved changes before (#160).
import { describe, expect, it, vi } from "vitest";
import { Buffers } from "../buffers";
import { answers, type WindowManagerHost } from "../wm/host";
import { lateWindowManager, testWindowManager } from "../wm/testing";
import type { Published } from "../wm/types";
import { takeDesk } from "../wm/view";
import { openSurface, settled, stash, windowsOf } from "./actions";
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
async function ctx(wm = testWindowManager()) {
  const store = new Store(sampleState("en", epoch));
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

/** A few tasks of the late window manager: every edit asked so far is in, and those they asked. */
const turns = () => new Promise((done) => setTimeout(done, 30));

describe("the focus settles while the window manager's desk comes late (#160)", () => {
  /** The runtime's focusSurface: its surface takes the keys, then its window shows (`windows.show`). */
  async function late() {
    const c = await ctx(lateWindowManager());
    c.focusSurface.mockImplementation((id: string | null) => {
      c.shortcuts.focused = id;
      if (id) void showPlugin(c, id);
    });
    return c;
  }

  it("two windows shown at once (a restore's files in two plugins) end on the second, and nothing moves after", async () => {
    const c = await late();
    const edit = vi.spyOn(c.wm, "edit");
    c.focusSurface("p.a");
    c.focusSurface("p.b");
    await turns();
    const asked = edit.mock.calls.length;
    await turns();
    expect(edit.mock.calls.length).toBe(asked);
    expect(asked).toBe(2);
    expect(c.store.get().focused).toBe("p.b");
    expect(c.shortcuts.focused).toBe("p.b");
  });

  it("a desk that answers a focus move asked before another does not take the keys back", async () => {
    const c = await late();
    const first = focusPane(c, "p.a");
    const second = focusPane(c, "p.b");
    await Promise.all([first, second]);
    await turns();
    expect(c.store.get().focused).toBe("p.b");
    expect(c.focusSurface.mock.calls.map(([id]) => id)).toEqual(["p.b"]);
  });

  it("a surface the runtime focused while the move was on its way keeps the keys", async () => {
    const c = await late();
    const showing = showPlugin(c, "p.a");
    // The palette (an overlay: no window shows it) takes the keys before the desk is in.
    c.shortcuts.focused = "p.palette";
    await showing;
    await turns();
    expect(c.store.get().focused).toBe("p.a");
    expect(c.shortcuts.focused).toBe("p.palette");
  });

  it("a pane in use by a desk not yet in is focused again, so the move after it does not win", async () => {
    const c = await late();
    await focusPane(c, "p.a");
    const moving = focusPane(c, "p.b");
    // The store still names p.a in use: the move to p.b is on its way.
    expect(c.store.get().focused).toBe("p.a");
    await Promise.all([moving, focusPane(c, "p.a")]);
    await turns();
    expect(c.store.get().focused).toBe("p.a");
    expect(c.shortcuts.focused).toBe("p.a");
  });
});

describe("a press that focuses a window and puts it in the drawer", () => {
  /**
   * desk-wm as the app's compositor runs it: each desk it publishes, and the answers it settles,
   * reach the page on a task of their own, so what a focus awaits runs before the next desk is in.
   */
  function onTasksOfTheirOwn(inner: ReturnType<typeof testWindowManager>): WindowManagerHost {
    const pending = answers();
    let take: (published: Published) => void = () => undefined;
    inner.connect((published) =>
      setTimeout(() => {
        take(published);
        pending.settle(published);
      }, 0),
    );
    return {
      ...inner,
      connect(next) {
        take = next;
      },
      edit(edits) {
        const { done } = pending.next();
        void inner.edit(edits);
        return done;
      },
    };
  }

  it("puts it away at once: the surfaces do not follow it back out of the drawer (issue 159)", async () => {
    const store = new Store(sampleState("en", epoch));
    const wm = onTasksOfTheirOwn(testWindowManager());
    wm.connect((published) => takeDesk(store, published));
    await wm.edit(["p.a", "p.b"].map((id) => ({ op: "adopt", id, title: id })));
    const shortcuts = { focused: null as string | null };
    const c = {
      store,
      wm,
      runtime: { shortcuts, focusSurface: (id: string | null) => focus(id) } as never,
      bridge: undefined as never,
      now: () => 1000,
      wall: () => epoch + 1000,
      tr: (key: string) => key,
    };
    // As the runtime does: a plugin's surface taking the keys shows its window.
    const focus = vi.fn((id: string | null) => {
      shortcuts.focused = id;
      if (id) void showPlugin(c, id);
    });
    await focusPane(c, "p.a");
    // The press focuses p.b, its click on the drawer tool puts it away.
    const pressed = focusPane(c, "p.b");
    const away = stash(c, "p.b", "B");
    await Promise.all([pressed, away]);
    await settled(c);
    const s = store.get();
    expect(windowsOf(s).map((p) => p.id)).not.toContain("p.b");
    expect(s.drawer.map((d) => d.id)).toContain("surface-p.b");
    expect(focus).not.toHaveBeenCalledWith("p.b");
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
