import { describe, expect, it } from "vitest";
import { Buffers } from "./buffers";
import type { BuffersPolicy } from "./policies/buffers";
import { connectViews, type HostViews } from "./views";

/** desk.buffers' side of it, as the policy does it for plugin surfaces. */
function buffersPolicy(): BuffersPolicy {
  const buffers = new Buffers();
  return {
    buffers,
    surfaceOpened: (plugin, title) =>
      void buffers.add({
        id: `surface:${plugin}`,
        name: title,
        plugin,
        modified: false,
        surface: true,
      }),
    surfaceClosed: (plugin) => {
      for (const buffer of buffers.ofPlugin(plugin)) buffers.remove(buffer.id);
    },
    focused: (plugin) => {
      const mine = plugin ? buffers.ofPlugin(plugin)[0] : undefined;
      if (mine) buffers.touch(mine.id);
    },
    show: async () => {},
    dispose: () => {},
  };
}

function hostViews() {
  const state = {
    ids: ["w1/p1"],
    focused: null as string | null,
    inUse: null as string | null,
    titles: { "w1/p1": "Notes" } as Record<string, string>,
  };
  const listeners = new Set<() => void>();
  const views: HostViews = {
    ids: () => state.ids,
    focused: () => state.focused,
    inUse: () => state.inUse,
    focus: (id) => {
      state.focused = id;
    },
    title: (id) => state.titles[id] ?? id,
    close: () => {},
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const change = (patch: Partial<typeof state>) => {
    Object.assign(state, patch);
    for (const listener of listeners) listener();
  };
  return { views, change };
}

describe("connectViews", () => {
  it("makes each view a buffer, in use while it has the focus, gone when it closes", () => {
    const policy = buffersPolicy();
    const { views, change } = hostViews();
    const routing = connectViews(views, policy);
    expect(routing.owns("w1/p1")).toBe(true);
    expect(policy.buffers.list().map((b) => [b.id, b.name])).toEqual([["surface:w1/p1", "Notes"]]);

    change({ ids: ["w1/p1", "w1/p2"], titles: { "w1/p1": "Notes", "w1/p2": "Calendar" } });
    change({ focused: "w1/p2" });
    expect(policy.buffers.current()?.plugin).toBe("w1/p2");

    change({ ids: ["w1/p1"] });
    expect(routing.owns("w1/p2")).toBe(false);
    expect(policy.buffers.list().map((b) => b.plugin)).toEqual(["w1/p1"]);
    routing.dispose();
  });

  it("the plugin surface the window in use shows is the buffer in use, whichever way the focus came (issue 163, finding 5)", () => {
    const policy = buffersPolicy();
    const { views, change } = hostViews();
    policy.surfaceOpened("test.database", "Database");
    const routing = connectViews(views, policy);
    change({ ids: ["w1/p1", "w2/p2"] });
    // A launcher pane was in use; then the window manager put Database's window in use (a press
    // on its title bar) without the runtime moving its own focus there.
    change({ focused: "w2/p2" });
    expect(policy.buffers.current()?.plugin).toBe("w2/p2");
    change({ focused: null, inUse: "test.database" });
    expect(policy.buffers.current()?.plugin).toBe("test.database");
    // Back to the pane, and to Database again: each time the one in use.
    change({ focused: "w2/p2", inUse: null });
    expect(policy.buffers.current()?.plugin).toBe("w2/p2");
    change({ focused: null, inUse: "test.database" });
    expect(policy.buffers.current()?.plugin).toBe("test.database");
    routing.dispose();
  });

  it("owns nothing without a host", () => {
    expect(connectViews(undefined, buffersPolicy()).owns("w1/p1")).toBe(false);
  });
});
