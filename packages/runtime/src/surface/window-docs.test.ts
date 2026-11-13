// @vitest-environment jsdom
// Where each window's DOM lies (ADR 0201): the desk's page or a page of its own; what reads a
// window's DOM finds it in either, and a point in a window's own page maps to the desk's.
import { describe, expect, it, vi } from "vitest";
import { windowDocs } from "./window-docs";
import type { WindowPages } from "./window-pages";

type Hook = (id: string, win: Window) => () => void;

/** Window pages as `windowPages` keeps them, opened and closed by the test. */
function fakePages() {
  const hooks = new Set<Hook>();
  const open = new Map<string, { win: Window; stops: Array<() => void> }>();
  const pages = {
    watch: vi.fn((run: Hook) => {
      hooks.add(run);
      for (const [id, at] of open) at.stops.push(run(id, at.win));
      return () => hooks.delete(run);
    }),
  } as unknown as WindowPages;
  const openPage = (id: string) => {
    const doc = document.implementation.createHTMLDocument("");
    const section = doc.createElement("section");
    section.className = "surface";
    section.dataset.surface = id;
    doc.body.append(section);
    const win = { document: doc } as unknown as Window;
    const at = { win, stops: [] as Array<() => void> };
    open.set(id, at);
    for (const run of hooks) at.stops.push(run(id, win));
    return { win, section };
  };
  const closePage = (id: string) => {
    for (const stop of open.get(id)?.stops ?? []) stop();
    open.delete(id);
  };
  return { pages, openPage, closePage };
}

describe("window docs", () => {
  it("find a window's section in its own page, else in the desk's page", () => {
    const desk = document.createElement("div");
    desk.innerHTML = `<section class="surface" data-surface="b"></section>`;
    const docs = windowDocs(() => undefined);
    const fake = fakePages();
    docs.attach(fake.pages);
    const { section } = fake.openPage("a");
    expect(docs.section("a", desk)).toBe(section);
    expect(docs.section("b", desk)).toBe(desk.querySelector("section"));
    fake.closePage("a");
    expect(docs.section("a", desk)).toBeNull();
  });

  it("say which window a page is, and map its points to the desk's", () => {
    const docs = windowDocs((id) => (id === "a" ? { x: 300, y: 120, w: 400, h: 300 } : undefined));
    const fake = fakePages();
    docs.attach(fake.pages);
    const { win } = fake.openPage("a");
    expect(docs.windowOf(win.document)).toBe("a");
    expect(docs.windowOf(document)).toBeUndefined();
    expect(docs.toDesk("a", { x: 10, y: 20 })).toEqual({ x: 310, y: 140 });
    expect(docs.toDesk("gone", { x: 10, y: 20 }), "no place known: as it is").toEqual({
      x: 10,
      y: 20,
    });
  });

  it("run a watch on pages that open before or after it, and its stops as they close", () => {
    const docs = windowDocs(() => undefined);
    const fake = fakePages();
    const seen: string[] = [];
    const watched = docs.watch((id) => {
      seen.push(`+${id}`);
      return () => seen.push(`-${id}`);
    });
    docs.attach(fake.pages);
    fake.openPage("a");
    fake.openPage("b");
    fake.closePage("a");
    expect(seen).toEqual(["+a", "+b", "-a"]);
    watched();
    fake.openPage("c");
    expect(seen).toEqual(["+a", "+b", "-a"]);
  });
});
