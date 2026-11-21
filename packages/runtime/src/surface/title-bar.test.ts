// @vitest-environment jsdom
// A window's title bar (#298, ADR 0255): 36 high, and three tools at its end: the window menu, Pop
// out where the window shows one plugin, and Close. The rest of what the bar's tools did are rows of
// the window menu (`desktops/window-menu.test.ts`). Each tool's hover title is its name and key; a
// pinned or a floating window says so with a mark, not a button. On the bar `title-bar.ts` builds,
// over desk-wm as WebAssembly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provideWindowMenu } from "../desktops/ui";
import type { SurfacePlacement } from "../modes/types";
import { edit, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { type CopyKey, t } from "../shell/copy";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import { hostGestures } from "./host-gestures";
import { mountTitleBar } from "./title-bar";

const epoch = Date.parse("2026-11-21T09:00:00.000Z");

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
const place = (placement: SurfacePlacement): Edit => ({ op: "place", desktop: "1", placement });

/** A desk with a window of one plugin (Mail), one of two tabs, and one of the desk's own views. */
async function desk() {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const keys: Record<string, string> = {
    "desk.windows.pop-out": "⌥⌘O",
    "desk.windows.close": "⇧⌘W",
  };
  const ctx = {
    store,
    wm,
    runtime: { notify: vi.fn() },
    tr: (key: CopyKey, vars?: Record<string, string | number>) => t(store.get().lang, key, vars),
    keyOf: (command: string) => keys[command],
  } as unknown as ShellCtx;
  await edit(ctx, { op: "adopt", id: "endue.mail", title: "Mail" });
  const split = {
    kind: "split" as const,
    id: "s1",
    dir: "row" as const,
    ratio: 0.5,
    a: { kind: "view" as const, id: "p1", view: "notes" },
    b: { kind: "view" as const, id: "p2", view: "calendar" },
  };
  await wm.edit([
    place(at("endue.mail", 300, { plugin: "endue.mail" })),
    place(at("window-1", 800, { panes: split })),
    place(at("tomorrow", 700)),
  ]);
  const placed = (id: string) => {
    const p = windowsOf(store.get()).find((w) => w.id === id);
    if (!p) throw new Error(`no window ${id}`);
    return p;
  };
  return { store, wm, ctx, keys, placed };
}

const tools = (bar: HTMLElement) => [
  ...bar.querySelectorAll<HTMLButtonElement>(".surface-tools button:not([hidden])"),
];
const names = (bar: HTMLElement) => tools(bar).map((b) => b.getAttribute("aria-label"));

afterEach(() => document.body.replaceChildren());

describe("a window's title bar", () => {
  it("a title bar is 36 high in the page's style sheet", () => {
    const css = readFileSync(join(import.meta.dirname, "surface.css"), "utf8");
    expect(css).toMatch(/--surface-title-height:\s*36px;/);
    expect(css.match(/\b36px\b/g)).toHaveLength(1);
    expect(css).toMatch(/grid-template-rows:\s*var\(--surface-title-height\)\s+minmax\(0, 1fr\);/);
    const title = css.slice(css.indexOf(".surface-title {"));
    expect(title.slice(0, title.indexOf("}"))).toMatch(/height:\s*var\(--surface-title-height\);/);
    expect(css).not.toMatch(/\b40px\b/);
  });

  it("a title bar shows three tools: the window menu, Pop out and Close", async () => {
    const { ctx, placed } = await desk();
    const one = mountTitleBar(ctx, () => placed("endue.mail"));
    one.relabel();
    expect(names(one.el)).toEqual(["Window menu", "Pop out", "Close"]);
    // A window of several tabs, and one of the desk's own views: no pop out.
    for (const id of ["window-1", "tomorrow"]) {
      const bar = mountTitleBar(ctx, () => placed(id));
      bar.relabel();
      expect(names(bar.el), id).toEqual(["Window menu", "Close"]);
    }
    // Nothing on the bar opens a tab, floats, pins or puts the window away: the menu does.
    const all = [...one.el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    for (const gone of ["New tab", "Floating mode", "Pin", "Unpin", "Put in drawer"]) {
      expect(all.some((name) => name?.startsWith(gone))).toBe(false);
    }
  });

  it("every tool has a tooltip with its name and key", async () => {
    const { ctx, store, keys, placed } = await desk();
    const bar = mountTitleBar(ctx, () => placed("endue.mail"));
    bar.relabel();
    const [menu, out, close] = tools(bar.el);
    expect([menu?.title, out?.title, close?.title]).toEqual([
      "Window menu",
      "Pop out (⌥⌘O)",
      "Close (⇧⌘W)",
    ]);
    expect(close?.getAttribute("aria-label")).toBe("Close");
    expect(menu?.getAttribute("aria-haspopup")).toBe("menu");
    expect(menu?.getAttribute("aria-expanded")).toBe("false");
    // The keymap changed, and the language.
    keys["desk.windows.close"] = "⌘W";
    delete keys["desk.windows.pop-out"];
    bar.relabel();
    expect([out?.title, close?.title]).toEqual(["Pop out", "Close (⌘W)"]);
    store.set({ lang: "ko" });
    bar.relabel();
    expect([menu?.title, close?.title]).toEqual(["창 메뉴", "닫기 (⌘W)"]);
    expect(close?.getAttribute("aria-label")).toBe("닫기");
  });

  it("the window menu's tool opens the window's menu under it", async () => {
    const { ctx, store, placed } = await desk();
    const toggle = vi.fn();
    const off = provideWindowMenu(store, { toggle });
    const bar = mountTitleBar(ctx, () => placed("endue.mail"));
    tools(bar.el)[0]?.click();
    expect(toggle).toHaveBeenCalledWith("endue.mail", tools(bar.el)[0]);
    off();
  });

  it("pinned and floating show on the bar", async () => {
    const { ctx } = await desk();
    let p = at("notes", 100);
    const bar = mountTitleBar(ctx, () => p);
    const marks = () =>
      [...bar.el.querySelectorAll<HTMLElement>(".surface-mark:not([hidden])")].map((m) => [
        m.dataset.mark,
        m.getAttribute("role"),
        m.getAttribute("aria-label"),
      ]);
    bar.relabel();
    expect(marks()).toEqual([]);
    p = { ...p, pinned: true };
    bar.relabel();
    expect(marks()).toEqual([["pinned", "img", "Pinned"]]);
    p = { ...p, floating: true };
    bar.relabel();
    expect(marks()).toEqual([
      ["pinned", "img", "Pinned"],
      ["floating", "img", "Floating"],
    ]);
    expect(bar.el.querySelector(".surface-mark")?.closest("button")).toBeNull();
  });

  it("a double-click on the title maximizes, and one on a tool does not", async () => {
    const { ctx, wm, placed } = await desk();
    const run = vi.spyOn(wm, "run");
    const bar = mountTitleBar(ctx, () => placed("endue.mail"));
    bar.relabel();
    tools(bar.el)[2]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(run).not.toHaveBeenCalled();
    bar.heading.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(run).toHaveBeenCalledWith({ op: "maximize" }, "endue.mail");
  });

  it("a press on the title starts a move, and one on a tool does not", async () => {
    const { ctx, placed } = await desk();
    const grab = vi.fn();
    const host = { ...ctx, wm: { ...ctx.wm, grab } } as unknown as ShellCtx;
    const bar = mountTitleBar(ctx, () => placed("endue.mail"));
    const section = document.createElement("section");
    section.append(bar.el);
    document.body.append(section);
    for (const node of [section, bar.el]) {
      node.setPointerCapture = vi.fn();
      node.releasePointerCapture = vi.fn();
    }
    const off = hostGestures(section, bar.el, () => placed("endue.mail"), host);
    const press = (target: Element) =>
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: 340,
          clientY: 218,
        }),
      );
    press(tools(bar.el)[0] as Element);
    expect(grab).not.toHaveBeenCalled();
    press(bar.heading);
    expect(grab).toHaveBeenCalledWith({ kind: "move", window: "endue.mail" }, { x: 340, y: 218 });
    off();
  });
});
