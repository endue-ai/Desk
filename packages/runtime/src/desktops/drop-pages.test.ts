// @vitest-environment jsdom
// A window dragged in its own page (ADR 0201) onto the desktop switcher: its page hears the pointer,
// whose points are the window's on the desk, and the desktop under it lights up.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { windowDocs } from "../surface/window-docs";
import type { WindowPages } from "../surface/window-pages";
import { windowDrops } from "./drop";

type Hook = (id: string, win: Window) => () => void;

/** Window `id`'s own page, its section dragged; its window's events go to its document. */
function draggedPage(id: string) {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = `<section class="surface is-dragging" data-surface="${id}"></section>`;
  const target = doc.defaultView ?? doc;
  const win = {
    document: doc,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as Window;
  return { win, doc };
}

describe("a window dropped on the switcher from its own page", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove("is-grabbing");
  });

  it("lights the desktop under the pointer, at the window's place on the desk", () => {
    const base = emptyState("en");
    const notes = { id: "notes", plugin: "endue.notes", x: 0, y: 0, w: 400, h: 300, pinned: false };
    const store = new Store({ ...base, wm: { ...base.wm, windows: { "1": [notes] } } });
    // The gesture holds the window at 300,0 on the desk.
    const pages = windowDocs((id) =>
      id === "notes" ? { x: 300, y: 0, w: 400, h: 300 } : undefined,
    );
    const ctx = { store, pages } as unknown as ShellCtx;
    const switcher = document.createElement("div");
    const second = document.createElement("button");
    second.dataset.desktopId = "2";
    switcher.append(second);
    document.body.append(switcher);
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({
      left: 500,
      right: 560,
      top: 0,
      bottom: 40,
    } as DOMRect);
    const off = windowDrops(ctx, switcher);
    const page = draggedPage("notes");
    const fake = {
      watch: vi.fn((run: Hook) => {
        run("notes", page.win);
        return () => {};
      }),
    } as unknown as WindowPages;
    pages.attach(fake);
    document.documentElement.classList.add("is-grabbing");
    // 210,8 in the window's page is 510,8 on the desk: over the second desktop.
    page.doc.dispatchEvent(new MouseEvent("pointermove", { clientX: 210, clientY: 8 }));
    expect(second.classList.contains("is-drop-target")).toBe(true);
    page.doc.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 8 }));
    expect(second.classList.contains("is-drop-target"), "320,8 is over no desktop").toBe(false);
    off();
  });
});
