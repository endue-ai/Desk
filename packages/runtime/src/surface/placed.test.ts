// The shell wakes the plugins its windows place (#590): one that started asleep has no surface,
// and a window showing only plugins the runtime does not hold is not drawn.
import { describe, expect, it, vi } from "vitest";
import type { DesktopLayout, SurfacePlacement } from "../modes/types";
import { Store, sampleState } from "../shell/state";
import { wakePlaced } from "./placed";

const at = (
  id: string,
  plugin: string,
  more: Partial<SurfacePlacement> = {},
): SurfacePlacement => ({
  id,
  plugin,
  x: 100,
  y: 100,
  w: 400,
  h: 300,
  pinned: false,
  ...more,
});

const layout = (surfaces: SurfacePlacement[]): DesktopLayout => ({
  surfaces,
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
});

describe("wakePlaced", () => {
  it("the windows of the desktop in front wake the plugins they place, once asked and as the layout changes", async () => {
    const store = new Store(sampleState("en", 0));
    const wake = vi.fn();
    const ctx = { store, runtime: { plugins: { wake } } } as never;
    store.set({
      desktop: "1",
      session: {
        "1": layout([
          // A profile's window named after its surface shows the plugin it names.
          at("terminal", "endue.terminal"),
          at("window-1", "endue.window", {
            panes: {
              kind: "split",
              id: "s1",
              dir: "row",
              ratio: 0.5,
              a: { kind: "view", id: "p1", view: "plugin:endue.git" },
              b: { kind: "view", id: "p2", view: "launcher" },
            },
          }),
        ]),
        "2": layout([
          at("mail", "endue.mail", {
            panes: { kind: "view", id: "p1", view: "plugin:endue.mail" },
          }),
        ]),
      },
    });
    const placed = wakePlaced(ctx);
    placed.now();
    const woken = () => new Set(wake.mock.calls.map(([id]) => id));
    expect(woken()).toEqual(new Set(["endue.terminal", "endue.window", "endue.git"]));

    // The desktop with Mail comes to the front: its window wakes Mail.
    store.set({ desktop: "2" });
    await Promise.resolve();
    expect(woken()).toContain("endue.mail");
    placed.off();
    wake.mockClear();
    store.set({ desktop: "1" });
    await Promise.resolve();
    expect(wake).not.toHaveBeenCalled();
  });
});
