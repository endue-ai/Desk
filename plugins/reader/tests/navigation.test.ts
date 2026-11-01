// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createChapters } from "../ui/chapters.js";
import { createPages } from "../ui/pages.js";
import { createView } from "../ui/view.js";
import { loadPage } from "./harness";

afterEach(() => vi.useRealTimers());
const chapter = { html: "<p>Chapter</p>", css: [], fonts: [] };
const pages = {
  kind: "pages" as const,
  format: "PDF",
  pages: Array.from({ length: 3 }, () => ({ width: 100, height: 200 })),
  toc: [],
  text: async () => "",
  paint: async () => {},
};
const chapters = {
  kind: "chapters" as const,
  format: "EPUB",
  chapters: [{ title: "One" }, { title: "Two" }],
  toc: [],
  chapter: async () => chapter,
  target: () => undefined,
  text: async () => "",
};

it.each(["pages", "chapters"])("clearing %s retires its queued scroll report", async (kind) => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.append(host);
  const moved = vi.fn();
  const hooks = { moved, go() {}, external() {} };
  const view =
    kind === "pages"
      ? createPages(document, host, scroller, hooks)
      : createChapters(host, scroller, hooks);
  if ("load" in view) view.load(pages, { at: { unit: 1, offset: 0 }, zoom: 1 });
  else await view.show(chapters, 1);
  scroller.dispatchEvent(new Event("scroll"));
  view.clear();
  await vi.runAllTimersAsync();
  expect(moved).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("an aborted chapter navigation cannot report its position into the next book", async () => {
  loadPage(document);
  const moved = vi.fn();
  const view = createView(document, {
    moved,
    zoomed() {},
    bookmark() {},
    note() {},
    forget() {},
    unlock() {},
  });
  const model = (book: typeof pages | typeof chapters, unit = 0) => ({
    buffer: book.format,
    path: book.format,
    name: book.format,
    size: 1,
    book,
    at: { unit, offset: 0 },
    zoom: 1,
    bookmarks: [],
    notes: [],
  });
  const pending = { ...chapters, chapter: () => new Promise<typeof chapter>(() => {}) };
  view.show(model(pending));
  const input = document.getElementById("page") as HTMLInputElement;
  input.value = "2";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  view.show(model(pages, 1));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(moved).not.toHaveBeenCalled();
  expect(input.value).toBe("2");
  view.show(null);
});
