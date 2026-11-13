// @vitest-environment jsdom
// A window's menu from its title bar in the window's own page (ADR 0201): the right-click reaches
// the desk's menus, which open it at the window's place on the desk plus where it was pressed.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { windowDocs } from "../surface/window-docs";
import type { WindowPages } from "../surface/window-pages";
import { mountMenus } from "./menu";

type Hook = (id: string, win: Window) => () => void;

/** Window `id`'s own page, with its title bar. */
function windowPage(id: string) {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = `<section class="surface" data-surface="${id}"><div class="surface-title"><span>Notes</span></div></section>`;
  return { document: doc } as unknown as Window;
}

describe("a window's menu from its own page", () => {
  afterEach(() => document.body.replaceChildren());

  it("opens at the window's place on the desk plus the press", () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      value: 1440,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      value: 900,
      configurable: true,
    });
    const store = new Store(emptyState("en"));
    const pages = windowDocs((id) =>
      id === "notes" ? { x: 300, y: 120, w: 400, h: 300 } : undefined,
    );
    const ctx = { store, tr: (key: string) => key, pages } as unknown as ShellCtx;
    const root = document.createElement("div");
    const switcher = document.createElement("div");
    document.body.append(root, switcher);
    const menus = mountMenus(root, ctx, switcher);
    const hooks = new Set<Hook>();
    const win = windowPage("notes");
    const fake = {
      watch: vi.fn((run: Hook) => {
        hooks.add(run);
        run("notes", win);
        return () => hooks.delete(run);
      }),
    } as unknown as WindowPages;
    pages.attach(fake);
    const bar = win.document.querySelector(".surface-title span");
    bar?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 12 }),
    );
    const menu = root.querySelector<HTMLElement>(".desktops-menu");
    expect(menu, "the window's menu opened").not.toBeNull();
    expect(store.get().popover).toBe("window-menu");
    expect([menu?.style.left, menu?.style.top]).toEqual(["340px", "132px"]);
    menus.dispose();
  });
});
