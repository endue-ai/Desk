// @vitest-environment jsdom
// The page view's place and its narrow page, on the plugin's own index.html: where the person is in
// the pages (a page, a share down it, a share across) read and gone back to with the zoom they chose
// (#162, ADR 0176); in a narrow page the outline and the comments start folded and open over the
// pages one at a time (#162 finding 8). jsdom lays nothing out: the pages' boxes are given.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, DocModel, Paragraph } from "../ui/model.js";
import { NARROW } from "../ui/view/panels.js";
import { createView } from "../ui/view/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");

const para = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({
  type: "paragraph",
  inlines: [{ type: "text", text }],
  ...extra,
});
const model = (blocks: Block[]): DocModel => ({
  kind: "document",
  format: "docx",
  formatName: "Word document",
  textOnly: false,
  title: "",
  sections: [
    {
      width: 612,
      height: 792,
      margins: { top: 72, right: 72, bottom: 72, left: 72 },
      header: [],
      footer: [],
      blocks,
    },
  ],
  notes: [],
  comments: [{ id: "c1", author: "Ana Lee", date: "", blocks: [para("Check this.")] }],
});
const DOC = model([
  para("Intro", { level: 1 }),
  { type: "pagebreak" },
  para("Two"),
  { type: "pagebreak" },
  para("Three"),
]);
const shown = (doc: DocModel, name = "a.docx") => ({
  buffer: `file:~/${name}`,
  path: `~/${name}`,
  name,
  size: 2048,
  doc,
});

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

/** The desk's view starts 100 px down; each page is 1000 px tall, 24 px apart, from 24 px. */
function layOut() {
  const desk = $("#desk");
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const index = this.classList.contains("page")
      ? Array.prototype.indexOf.call(this.parentElement?.children ?? [], this)
      : -1;
    const top = this === desk ? 100 : index >= 0 ? 100 + 24 + index * 1024 - desk.scrollTop : 0;
    return { top, height: index >= 0 ? 1000 : 300, left: 0, width: 400 } as DOMRect;
  });
  return desk;
}

/** A page `narrow` or not, as matchMedia answers for NARROW. */
function media(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === NARROW && narrow,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  document.documentElement.innerHTML = html
    .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/, "");
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("where the person is in the pages", () => {
  it("reads the page at the top of the view and how far down it, and the zoom they chose", async () => {
    const view = createView(document);
    await view.show(shown(DOC));
    const desk = layOut();
    expect(view.where()).toEqual({ at: { page: 0, down: 0, across: 0 }, zoom: null });
    desk.scrollTop = 24 + 1024 + 250;
    expect(view.where()).toEqual({ at: { page: 1, down: 0.25, across: 0 }, zoom: null });
    $("#zoom-in").click();
    expect(view.where().zoom).toBe(1.1);
  });

  it("goes back there with the zoom, and another document starts at its first page", async () => {
    const view = createView(document);
    const desk = layOut();
    await view.show(shown(DOC), { at: { page: 2, down: 0.5, across: 0 }, zoom: 1.5 });
    expect($("#sheet").style.zoom).toBe("1.5");
    expect($("#zoom-level").textContent).toBe("150%");
    expect(desk.scrollTop).toBe(24 + 2 * 1024 + 500);
    expect(view.where()).toEqual({ at: { page: 2, down: 0.5, across: 0 }, zoom: 1.5 });
    // The same document shown again stays where it is.
    await view.show(shown(DOC));
    expect(desk.scrollTop).toBe(24 + 2 * 1024 + 500);
    await view.show(shown(model([para("Other")]), "b.docx"));
    expect(desk.scrollTop).toBe(0);
    // The zoom the person chose stays the view's.
    expect($("#sheet").style.zoom).toBe("1.5");
  });

  it("has no place without a document", async () => {
    const view = createView(document);
    expect(view.where()).toEqual({ at: null, zoom: null });
    await view.show(null);
    expect(view.where().at).toBeNull();
  });
});

describe("a narrow page", () => {
  it("folds the outline and the comments, and opens one at a time over the pages", async () => {
    media(true);
    Element.prototype.scrollIntoView = vi.fn();
    const view = createView(document);
    await view.show(shown(DOC));
    const outline = $("#outline");
    const comments = $("#comments");
    expect([outline.hidden, comments.hidden]).toEqual([true, true]);
    expect($("#outline-toggle").getAttribute("aria-pressed")).toBe("false");
    $("#outline-toggle").click();
    expect([outline.hidden, comments.hidden]).toEqual([false, true]);
    expect($("#outline-toggle").getAttribute("aria-pressed")).toBe("true");
    $("#comments-toggle").click();
    expect([outline.hidden, comments.hidden]).toEqual([true, false]);
    // Escape folds it, and is taken.
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect([outline.hidden, comments.hidden]).toEqual([true, true]);
    // A heading chosen folds the outline to show it.
    $("#outline-toggle").click();
    $<HTMLButtonElement>("#outline-list button").click();
    expect(outline.hidden).toBe(true);
    // The next document starts folded too.
    $("#comments-toggle").click();
    await view.show(shown(model([para("Other")]), "b.docx"));
    expect([outline.hidden, comments.hidden]).toEqual([true, true]);
  });

  it("a wide page keeps them beside the pages, closed only when the person closes them", async () => {
    media(false);
    const view = createView(document);
    await view.show(shown(DOC));
    expect([$("#outline").hidden, $("#comments").hidden]).toEqual([false, false]);
    $("#outline-toggle").click();
    await view.show(shown(model([para("Other")]), "b.docx"));
    expect($("#outline").hidden).toBe(true);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });
});
