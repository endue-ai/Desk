// @vitest-environment jsdom
// The drawer in the strip under the canvas map (issue 296): its button with the count, its panel
// opening from there, its contents and Raise as they were, and a layout that hides it hiding the
// button alone. Where the panel is drawn is the e2e's (`e2e/shell.spec.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "../clock";
import type { CommandSpec } from "../commands";
import { ShortcutRouter } from "../input";
import { Keymap } from "../keymap";
import { Settings } from "../settings";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { edit, layoutOf, settled } from "./actions";
import { mountBottom } from "./Bottom";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { type DrawerItem, Store, sampleState } from "./state";
import { Ticker } from "./ticker";

const epoch = Date.parse("2026-11-16T09:00:00.000Z");
const HOUR = 3_600_000;

describe("the drawer under the canvas map", () => {
  let root: HTMLDivElement;
  let store: Store;
  let ctx: ShellCtx;
  let dispose: () => void;
  let ticker: Ticker;

  const mount = async (items: DrawerItem[]) => {
    store = new Store(sampleState("en", epoch));
    const wm = testWindowManager();
    wm.connect((published) => takeDesk(store, published));
    const defined = new Map<string, CommandSpec>();
    const commands = {
      list: () => [],
      has: (id: string) => defined.has(id),
      define: (id: string, spec: CommandSpec) => {
        defined.set(id, spec);
        return () => defined.delete(id);
      },
      run: (id: string) => Promise.resolve(defined.get(id)?.run(undefined, {})),
    };
    const shortcuts = new ShortcutRouter({ platform: "mac" });
    ticker = new Ticker(new ManualClock());
    ctx = {
      store,
      wm,
      ticker,
      reduced: () => true,
      platform: "mac",
      now: () => 0,
      wall: () => epoch,
      keyOf: () => undefined,
      tr: (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
        t("en", key, vars),
      runtime: {
        commands,
        settings: new Settings(),
        shortcuts,
        keymap: new Keymap(shortcuts, commands as never),
        focusSurface: () => {},
        followSurface: () => {},
        notify: vi.fn(),
      },
      eris: { say: vi.fn(), setState: vi.fn() },
      bridge: { agents: { card: async () => ({}) } },
    } as unknown as ShellCtx;
    await edit(ctx, { op: "drawer", items });
    root = document.createElement("div");
    root.className = "shell";
    document.body.append(root);
    dispose = mountBottom(root, ctx);
  };
  const sample = () => sampleState("en", epoch).drawer;

  beforeEach(() => mount(sample()));

  afterEach(() => {
    dispose();
    ticker.dispose();
    root.remove();
  });

  const button = () => root.querySelector<HTMLButtonElement>(".drawer-button") as HTMLButtonElement;
  const panel = () => root.querySelector<HTMLElement>(".drawer-panel");

  it("the Drawer button carries its count and opens its panel from the strip", () => {
    const label = t("en", "drawer", { n: 3 });
    expect(button().getAttribute("aria-label")).toBe(label);
    expect(button().title).toBe(label);
    expect(button().querySelector(".badge")?.textContent).toBe("3");
    expect(button().closest(".map-strip .drawer")).not.toBeNull();
    button().click();
    expect(store.get().popover).toBe("drawer");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect(panel()?.getAttribute("aria-label")).toBe(t("en", "drawerTitle"));
    expect(panel()?.closest(".map-strip .drawer")).not.toBeNull();
    button().click();
    expect(store.get().popover).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();
  });

  it("the panel's contents and Raise are unchanged", async () => {
    dispose();
    root.remove();
    ticker.dispose();
    const old = { id: "recent-old", kind: "recent" as const, name: "Old", at: epoch - 25 * HOUR };
    await mount([...sample(), old]);
    button().click();
    const listed = () =>
      [...(panel()?.querySelectorAll<HTMLElement>(".drawer-item") ?? [])].map(
        (el) => el.dataset.item,
      );
    expect(listed()).toEqual(["file-brief", "recent-weather", "recent-summary"]);
    const sections = [...(panel()?.children ?? [])].map((el) => el.className);
    expect(sections).toEqual(["pop-title", "drawer-list", "drawer-section", "drawer-list"]);
    expect(panel()?.querySelector(".drawer-section")?.textContent).toBe(t("en", "recent"));
    root
      .querySelector<HTMLButtonElement>('.drawer-panel [data-key="raise-recent-weather"]')
      ?.click();
    await settled(ctx);
    expect(store.get().popover).toBeNull();
    expect(store.get().drawer.some((d) => d.id === "recent-weather")).toBe(false);
    expect(button().querySelector(".badge")?.textContent).toBe("2");
    expect(button().getAttribute("aria-label")).toBe(t("en", "drawer", { n: 2 }));
    expect(button().closest(".map-strip")).not.toBeNull();
  });

  it("a profile whose layout hides the drawer hides the button, not the strip", () => {
    store.set((s) => ({
      wm: {
        ...s.wm,
        layouts: { ...s.wm.layouts, "1": { ...layoutOf(s), drawer: { visible: false } } },
      },
    }));
    const drawer = root.querySelector<HTMLElement>(".drawer");
    expect(drawer?.hidden).toBe(true);
    expect(drawer?.closest(".map-strip")).not.toBeNull();
    for (const selector of [".map-strip", ".map-strip-name", ".canvas-reset"]) {
      const el = root.querySelector<HTMLElement>(selector);
      expect(el).not.toBeNull();
      expect(el?.closest("[hidden]")).toBeNull();
    }
  });
});
