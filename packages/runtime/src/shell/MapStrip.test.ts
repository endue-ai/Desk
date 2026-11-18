// @vitest-environment jsdom
// The strip under the canvas map (issue 296, design #291): the desktop's name, the Drawer button and
// the origin button, beside the bottom edge and nothing of them left at the bottom left. jsdom lays
// nothing out: where it is drawn is the e2e's (`e2e/shell-canvas.spec.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "../clock";
import type { CommandSpec } from "../commands";
import { ShortcutRouter } from "../input";
import { Keymap } from "../keymap";
import { Settings } from "../settings";
import type { LocalWindowManager } from "../wm/local";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { edit, setDesktop, settled } from "./actions";
import { mountBottom } from "./Bottom";
import { mapWidthOf } from "./MapStrip";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { Store, sampleState } from "./state";
import { Ticker } from "./ticker";

const epoch = Date.parse("2026-11-16T09:00:00.000Z");

describe("the strip under the canvas map", () => {
  let root: HTMLDivElement;
  let store: Store;
  let wm: LocalWindowManager;
  let ctx: ShellCtx;
  let dispose: () => void;
  let ticker: Ticker;

  beforeEach(async () => {
    const sample = sampleState("en", epoch);
    store = new Store(sample);
    wm = testWindowManager();
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
        t(store.get().lang, key, vars),
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
    await edit(ctx, { op: "drawer", items: sample.drawer });
    root = document.createElement("div");
    root.className = "shell";
    document.body.append(root);
    dispose = mountBottom(root, ctx);
  });

  afterEach(() => {
    dispose();
    ticker.dispose();
    root.remove();
  });

  const strip = () => root.querySelector<HTMLElement>(".map-strip");
  const name = () => root.querySelector<HTMLElement>(".map-strip .map-strip-name");
  const reset = () => root.querySelector<HTMLButtonElement>(".map-strip .canvas-reset");

  it("the strip holds the desktop's name, the Drawer button and the origin button, in that order", () => {
    expect(root.querySelectorAll(".map-strip")).toHaveLength(1);
    const footer = root.querySelector("footer.bottom");
    expect(strip()?.parentElement).toBe(footer?.parentElement);
    expect(footer?.contains(strip() as Node)).toBe(false);
    const children = [...(strip()?.children ?? [])];
    expect(children.map((c) => c.className)).toEqual([
      "map-strip-name",
      "drawer",
      "canvas-reset icon-button",
    ]);
    expect(children[1]?.querySelector(".drawer-button")).not.toBeNull();
    // After the footer: the tab order meets it after the talk pill and the running work.
    expect(footer?.compareDocumentPosition(strip() as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("the name is the desktop in front's and follows it", async () => {
    expect(name()?.textContent).toBe("Desktop 1");
    await edit(ctx, { op: "rename-desktop", desktop: "2", name: "Mail" });
    await setDesktop(ctx, "2");
    expect(name()?.textContent).toBe("Mail");
    await setDesktop(ctx, "3");
    expect(name()?.textContent).toBe("Desktop 3");
    await setDesktop(ctx, "1");
    store.set({ lang: "ko" });
    expect(name()?.textContent).toBe("데스크톱 1");
  });

  it("the origin button is always there, disabled while the canvas is at its origin", async () => {
    const label = t("en", "resetPan");
    expect(reset()?.disabled).toBe(true);
    expect(reset()?.getAttribute("aria-label")).toBe(label);
    expect(reset()?.title).toBe(label);
    await edit(ctx, { op: "pan", to: { x: -300, y: -200 } });
    expect(store.get().pan["1"]).toEqual({ x: -300, y: -200 });
    expect(reset()?.disabled).toBe(false);
    const sent = vi.spyOn(wm, "edit");
    reset()?.click();
    expect(sent).toHaveBeenCalledWith([{ op: "pan", to: { x: 0, y: 0 } }]);
    await settled(ctx);
    expect(reset()?.disabled).toBe(true);
    expect(strip()?.contains(reset())).toBe(true);
  });

  it("a folded map leaves the strip and both buttons as they are", () => {
    store.set({ mapFolded: false });
    const parts = [strip(), name(), root.querySelector(".drawer-button"), reset()];
    store.set({ mapFolded: true });
    const folded = [strip(), name(), root.querySelector(".drawer-button"), reset()];
    expect(folded).toEqual(parts);
    for (const el of folded) {
      expect(el).not.toBeNull();
      expect(el?.closest("[hidden]")).toBeNull();
    }
    (root.querySelector(".drawer-button") as HTMLButtonElement).click();
    expect(store.get().popover).toBe("drawer");
    expect(root.querySelector(".map-strip .drawer-panel")).not.toBeNull();
  });

  it("follows the width the person gave the map, as wide as its box (ADR 0270)", () => {
    const width = () => document.documentElement.style.getPropertyValue("--map-width");
    expect(width()).toBe("");
    store.set({ mapWidth: 288 });
    expect(width()).toBe("298px");
    store.set({ mapWidth: null });
    expect(width(), "the default box: scale.css' own").toBe("");
    store.set({ mapWidth: 240 });
    dispose();
    expect(width(), "gone with the strip").toBe("");
    dispose = () => {};
  });

  it("holds a width to what the compositor draws", () => {
    expect(mapWidthOf(288)).toBe(288);
    expect(mapWidthOf(250.4)).toBe(250);
    expect(mapWidthOf(10)).toBe(144);
    expect(mapWidthOf(9000)).toBe(480);
    for (const no of [Number.NaN, Number.POSITIVE_INFINITY, "288", null, undefined]) {
      expect(mapWidthOf(no)).toBeNull();
    }
  });

  it("nothing of the drawer or the origin is left at the bottom left", async () => {
    await edit(ctx, { op: "pan", to: { x: -300, y: -200 } });
    expect(root.querySelector("footer.bottom .drawer")).toBeNull();
    const resets = [...root.querySelectorAll(".canvas-reset")];
    expect(resets).toHaveLength(1);
    expect(resets.every((el) => el.closest(".map-strip"))).toBe(true);
  });
});
