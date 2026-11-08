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
  title: "Pages",
  pages: Array.from({ length: 3 }, () => ({ width: 100, height: 200 })),
  toc: [],
  text: async () => "",
  paint: async () => {},
};
const chapters = {
  kind: "chapters" as const,
  format: "EPUB",
  title: "Chapters",
  chapters: [{ title: "One" }, { title: "Two" }],
  toc: [],
  chapter: async (_unit: number) => chapter,
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

it.each([false, true])(
  "an aborted navigation cannot report after a book switch (return: %s)",
  async (returnToBook) => {
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
    try {
      view.show(model(pending));
      const input = document.getElementById("page") as HTMLInputElement;
      input.value = "2";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      view.show(model(pages, 1));
      if (returnToBook) view.show(model(pending, 1));
      for (let i = 0; i < 12; i++) await Promise.resolve();
      expect(moved).not.toHaveBeenCalled();
      expect(input.value).toBe("2");
    } finally {
      view.show(null);
    }
  },
);

it.each([false, true])(
  "scroll reports wait for the requested chapter to commit (same book: %s)",
  async (sameBook) => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.append(host);
    const moved = vi.fn();
    const view = createChapters(host, scroller, { moved, go() {}, external() {} });
    let resolve!: (value: typeof chapter) => void;
    const read = vi.fn(async () => chapter);
    const next = { ...chapters, chapter: read };
    await view.show(next, 1);
    if (!sameBook) view.clear();
    read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = view.show(sameBook ? next : { ...next }, 0);
    try {
      scroller.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(150);
      expect(moved).not.toHaveBeenCalled();
      resolve(chapter);
      await pending;
      scroller.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(150);
      expect(moved).toHaveBeenCalledExactlyOnceWith({ unit: 0, offset: 0 });
    } finally {
      resolve(chapter);
      await pending;
      view.clear();
    }
  },
);

it("chapter links belong to the committed chapter while another book is loading", async () => {
  const host = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.append(host);
  const go = vi.fn();
  const external = vi.fn();
  const view = createChapters(host, scroller, { moved() {}, go, external });
  const linked = {
    ...chapter,
    html: '<a href="chapter2.xhtml">Inside</a><a class="external" title="https://example.com/">Outside</a>',
  };
  const target = vi.fn(() => ({ unit: 1 }));
  await view.show({ ...chapters, target, chapter: async () => linked }, 0);
  let resolve!: (value: typeof chapter) => void;
  const nextTarget = vi.fn(() => ({ unit: 0 }));
  const pending = view.show(
    {
      ...chapters,
      target: nextTarget,
      chapter: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
    0,
  );
  const clickLinks = () => {
    for (const link of view.root().querySelectorAll("a")) link.click();
  };
  try {
    clickLinks();
    expect(target).not.toHaveBeenCalled();
    expect(nextTarget).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    resolve(linked);
    await pending;
    clickLinks();
    expect(nextTarget).toHaveBeenCalledExactlyOnceWith("chapter2.xhtml", 0);
    expect(go).toHaveBeenCalledExactlyOnceWith({ unit: 0 });
    expect(external).toHaveBeenCalledExactlyOnceWith("https://example.com/");
  } finally {
    resolve(linked);
    await pending;
    view.clear();
  }
});

it("pending chapter controls use the new book's requested position", async () => {
  loadPage(document);
  const bookmark = vi.fn();
  const note = vi.fn();
  const view = createView(document, {
    moved() {},
    zoomed() {},
    bookmark,
    note,
    forget() {},
    unlock() {},
  });
  const model = (book: typeof chapters, unit: number) => ({
    buffer: book.title,
    path: book.title,
    name: book.title,
    size: 1,
    book,
    at: { unit, offset: 0.25 },
    zoom: 1,
    bookmarks: [],
    notes: [],
  });
  const old = {
    ...chapters,
    title: "Old",
    chapters: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
  };
  const read = vi.fn((_unit: number) => new Promise<typeof chapter>(() => {}));
  try {
    view.show(model(old, 2));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    view.show(model({ ...chapters, title: "New", chapter: read }, 0));
    document.getElementById("bookmark")?.click();
    expect(bookmark).toHaveBeenCalledExactlyOnceWith({ unit: 0, offset: 0.25 }, "One (25%)");
    document.getElementById("add-note")?.click();
    const text = document.getElementById("note-text") as HTMLTextAreaElement;
    text.value = "Remember";
    text.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(note).toHaveBeenCalledExactlyOnceWith({ unit: 0, offset: 0.25 }, "Remember");
    document.getElementById("next")?.click();
    expect(read.mock.calls.map(([unit]) => unit)).toEqual([0, 1]);
  } finally {
    view.show(null);
  }
});
