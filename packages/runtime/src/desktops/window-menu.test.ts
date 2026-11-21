// @vitest-environment jsdom
// A window's menu (#298, ADR 0255 over ADR 0117): what the title bar's tools did beyond its three
// are rows of the one window menu, which its tool opens under it and a right-click on the bar opens
// where it was pressed: New tab, Maximize or restore, Floating mode, Pin and Put in drawer, each
// with its key when its command has one, then the "Move to" rows. Each row runs what its tool ran;
// the menu works by keyboard and gives the focus back to the tool. On the bridge stub's core and
// desk-wm as WebAssembly.
import { BridgeClient, browserStub, stubCommands } from "@endue-ai/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineAwayCommand } from "../arrange/away";
import { Commands } from "../commands";
import type { SurfacePlacement } from "../modes/types";
import { edit, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { type CopyKey, t } from "../shell/copy";
import { Store, sampleState } from "../shell/state";
import { mountTitleBar } from "../surface/title-bar";
import { windowDocs } from "../surface/window-docs";
import type { WindowPages } from "../surface/window-pages";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import { mountMenus } from "./menu";

const epoch = Date.parse("2026-11-21T09:00:00.000Z");
const MENU = { w: 220, h: 300 };

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
const box = (el: Element, x: number, y: number) => {
  el.getBoundingClientRect = () => new DOMRect(x, y, 24, 24);
};

/** A desk with Mail's window and one of the desk's own views, the menus mounted in `root`. */
async function desk() {
  const registry = stubCommands((event) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const commands = new Commands(new BridgeClient(stub));
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const keys: Record<string, string> = {
    "desk.display.new-tab": "⌘D",
    "desk.display.maximize": "⌃⌘F",
  };
  const another = vi.fn((_plugin: string, _opening: (id: string) => void) => "mail-2");
  const pages = windowDocs((id) =>
    id === "notes" ? { x: 300, y: 120, w: 400, h: 300 } : undefined,
  );
  const ctx = {
    store,
    wm,
    pages,
    runtime: {
      commands,
      notify: vi.fn(),
      shortcuts: { focused: null },
      plugins: { another, unmount: vi.fn() },
    },
    wall: () => epoch + 1000,
    tr: (key: CopyKey, vars?: Record<string, string | number>) => t(store.get().lang, key, vars),
    keyOf: (command: string) => keys[command],
  } as unknown as ShellCtx;
  await edit(ctx, { op: "adopt", id: "endue.mail", title: "Mail" });
  await wm.edit([
    place(at("endue.mail", 300, { plugin: "endue.mail" })),
    place(at("window-2", 800, { plugin: "endue.window", tabs: [{ id: "p1", view: "notes" }] })),
    { op: "focus", window: "endue.mail" },
  ]);
  defineAwayCommand(ctx);
  await commands.settled();
  const root = document.createElement("div");
  const switcher = document.createElement("nav");
  document.body.append(root, switcher);
  const menus = mountMenus(root, ctx, switcher);
  const placed = (id: string) => windowsOf(store.get()).find((w) => w.id === id);
  /** Window `id`'s title bar in the desk's page, its window menu's tool at (x, y). */
  const bar = (id: string, x = 1000, y = 206, doc = document) => {
    const made = mountTitleBar(ctx, () => placed(id) ?? at(id, 0));
    made.relabel();
    const section = doc.createElement("section");
    section.className = "surface";
    section.dataset.surface = id;
    section.append(made.el);
    doc.body.append(section);
    const tool = made.el.querySelector<HTMLButtonElement>("[aria-haspopup='menu']");
    if (!tool) throw new Error("no window menu tool");
    box(tool, x, y);
    return { ...made, tool };
  };
  const menu = () => root.querySelector<HTMLElement>(".desktops-menu");
  const rows = () => [...(menu()?.querySelectorAll<HTMLElement>(".menu-item") ?? [])];
  const row = (label: string) => {
    const found = rows().find((r) => r.querySelector(".pop-text")?.textContent === label);
    if (!found) throw new Error(`no row ${label}`);
    return found;
  };
  const settle = () => wm.edit([]);
  return {
    store,
    wm,
    ctx,
    keys,
    another,
    commands,
    pages,
    root,
    menus,
    placed,
    bar,
    menu,
    rows,
    row,
    settle,
  };
}

const key = (target: Element, name: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );

beforeEach(() => {
  for (const [name, value] of [
    ["clientWidth", 1440],
    ["clientHeight", 900],
  ] as const) {
    Object.defineProperty(document.documentElement, name, { value, configurable: true });
  }
  for (const [name, value] of [
    ["offsetWidth", MENU.w],
    ["offsetHeight", MENU.h],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("desktops-menu") ? value : 0;
      },
    });
  }
});
afterEach(() => {
  for (const name of ["offsetWidth", "offsetHeight"]) {
    Reflect.deleteProperty(HTMLElement.prototype, name);
  }
  document.body.replaceChildren();
});

describe("a window's menu", () => {
  it("the window menu lists five rows with their keys", async () => {
    const d = await desk();
    d.bar("endue.mail").tool.click();
    const rows = d.rows();
    const shown = rows.map((r) => [
      r.querySelector(".pop-text")?.textContent,
      r.getAttribute("role"),
      r.getAttribute("aria-checked"),
      r.querySelector(".pop-muted")?.textContent ?? null,
    ]);
    expect(shown.slice(0, 5)).toEqual([
      ["New tab", "menuitem", null, "⌘D"],
      ["Maximize or restore", "menuitem", null, "⌃⌘F"],
      ["Floating mode", "menuitemcheckbox", "false", null],
      ["Pin", "menuitemcheckbox", "false", null],
      ["Put in drawer", "menuitem", null, null],
    ]);
    // ADR 0117's rows follow, under a rule.
    expect(rows[5]?.dataset.key).toMatch(/^menu-to-/);
    expect(rows[4]?.nextElementSibling?.getAttribute("role")).toBe("separator");
    // A key bound later shows the next time it opens; a window that takes no tab has no New tab.
    d.keys["desk.windows.put-away"] = "⌥⌘H";
    d.menus.dispose();
    const again = mountMenus(d.root, d.ctx, document.createElement("nav"));
    d.bar("endue.mail").tool.click();
    expect(d.row("Put in drawer").querySelector(".pop-muted")?.textContent).toBe("⌥⌘H");
    d.bar("window-2").tool.click();
    expect(d.row("New tab").hasAttribute("disabled")).toBe(true);
    again.dispose();
  });

  it("each row runs what its tool ran", async () => {
    const d = await desk();
    const open = () => d.bar("endue.mail").tool.click();
    const closed = () => expect(d.menu(), "the menu closed first").toBeNull();
    d.another.mockImplementation(() => {
      closed();
      return "mail-2";
    });
    open();
    d.row("New tab").click();
    expect(d.another).toHaveBeenCalledWith("endue.mail", expect.any(Function));
    const run = vi.spyOn(d.wm, "run").mockImplementation(() => {
      closed();
    });
    open();
    d.row("Maximize or restore").click();
    expect(run).toHaveBeenCalledWith({ op: "maximize" }, "endue.mail");
    open();
    d.row("Floating mode").click();
    await d.settle();
    expect(d.placed("endue.mail")?.floating).toBe(true);
    open();
    expect(d.row("Floating mode").getAttribute("aria-checked")).toBe("true");
    d.row("Pin").click();
    await d.settle();
    expect(d.placed("endue.mail")?.pinned).toBe(true);
    const ran = vi.spyOn(d.commands, "run");
    open();
    d.row("Put in drawer").click();
    expect(ran).toHaveBeenCalledWith("desk.windows.put-away", { window: "endue.mail" });
    await vi.waitFor(() => expect(d.placed("endue.mail")).toBeUndefined());
    expect(d.store.get().drawer.map((item) => item.id)).toEqual(["surface-endue.mail"]);
  });

  it("it works by keyboard and gives the focus back", async () => {
    const d = await desk();
    const { tool } = d.bar("endue.mail");
    // Enter or Space on a button is its click.
    tool.focus();
    tool.click();
    expect(tool.getAttribute("aria-expanded")).toBe("true");
    const focused = () => document.activeElement?.querySelector(".pop-text")?.textContent;
    expect(focused()).toBe("New tab");
    const menu = d.menu() as HTMLElement;
    key(menu, "ArrowDown");
    expect(focused()).toBe("Maximize or restore");
    key(menu, "ArrowUp");
    key(menu, "ArrowUp");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-to-new");
    key(menu, "Home");
    expect(focused()).toBe("New tab");
    key(menu, "End");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-to-new");
    key(menu, "Escape");
    expect(d.menu()).toBeNull();
    expect(document.activeElement).toBe(tool);
    expect(tool.getAttribute("aria-expanded")).toBe("false");
    tool.click();
    key(d.menu() as HTMLElement, "Tab");
    expect(d.menu()).toBeNull();
    expect(document.activeElement).toBe(tool);
    // A second press on the tool closes it.
    tool.click();
    tool.click();
    expect(d.menu()).toBeNull();
    // Enter on a row is its click: it runs, and the menu goes.
    tool.click();
    d.row("Pin").click();
    expect(d.menu()).toBeNull();
    expect(tool.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives the focus back to the tool in the window's own page", async () => {
    const d = await desk();
    const own = document.implementation.createHTMLDocument("");
    const hooks = new Set<(id: string, win: Window) => () => void>();
    d.pages.attach({
      watch: vi.fn((run: (id: string, win: Window) => () => void) => {
        hooks.add(run);
        run("notes", { document: own } as unknown as Window);
        return () => hooks.delete(run);
      }),
    } as unknown as WindowPages);
    await d.wm.edit([place(at("notes", 100))]);
    const { tool } = d.bar("notes", 360, 6, own);
    const focus = vi.spyOn(tool, "focus");
    tool.click();
    // Under the tool, on the desk's page: the window's place plus the tool's box.
    const menu = d.menu() as HTMLElement;
    expect(menu.ownerDocument).toBe(document);
    expect([menu.style.left, menu.style.top]).toEqual([
      `${300 + 384 - MENU.w}px`,
      `${120 + 30 + 6}px`,
    ]);
    key(menu, "Escape");
    expect(focus).toHaveBeenCalled();
    expect(tool.getAttribute("aria-expanded")).toBe("false");
    // The desk's page hears a press over a window too (ADR 0150), where nothing of its own lies:
    // the press on the tool that opened the menu, heard there late, is not one outside the menu,
    // which closes it as the desk does (`shell/Desk.ts`).
    const outside = () => d.store.set({ popover: null });
    document.addEventListener("pointerdown", outside);
    const pressAt = (x: number, y: number) =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }),
      );
    tool.click();
    pressAt(300 + 370, 120 + 18);
    expect(d.menu(), "a press on its tool").not.toBeNull();
    pressAt(300 + 200, 120 + 18);
    expect(d.menu(), "a press elsewhere").toBeNull();
    document.removeEventListener("pointerdown", outside);
  });

  it("it opens under its tool on the desk's page", async () => {
    const d = await desk();
    d.bar("endue.mail", 1000, 206).tool.click();
    const menu = d.menu() as HTMLElement;
    expect(menu.matches(".popover[role='menu']")).toBe(true);
    expect(menu.parentElement).toBe(d.root);
    expect(d.store.get().popover).toBe("window-menu");
    // Its right edge at the tool's, its top under the tool.
    expect([menu.style.left, menu.style.top]).toEqual([`${1024 - MENU.w}px`, `${230 + 6}px`]);
    // Kept inside the app near its left and bottom edges.
    d.bar("window-2", 10, 880).tool.click();
    const low = d.menu() as HTMLElement;
    expect([low.style.left, low.style.top]).toEqual(["8px", `${900 - MENU.h - 8}px`]);
  });

  it("a right-click on the title bar opens the same menu", async () => {
    const d = await desk();
    const { heading } = d.bar("endue.mail");
    heading.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 500,
        clientY: 220,
      }),
    );
    const labels = d.rows().map((r) => r.querySelector(".pop-text")?.textContent ?? r.dataset.key);
    expect(labels.slice(0, 5)).toEqual([
      "New tab",
      "Maximize or restore",
      "Floating mode",
      "Pin",
      "Put in drawer",
    ]);
    const menu = d.menu() as HTMLElement;
    expect([menu.style.left, menu.style.top]).toEqual(["500px", "220px"]);
  });
});
