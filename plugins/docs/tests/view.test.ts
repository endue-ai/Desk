// @vitest-environment jsdom
// The page view on the plugin's own index.html: pages at the section's size, breaks, the outline,
// the comments panel, find, zoom, the details view, and file text reaching the DOM only as text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, DocModel, Paragraph } from "../ui/model.js";
import { createView } from "../ui/view/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");

const para = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({
  type: "paragraph",
  inlines: [{ type: "text", text }],
  ...extra,
});

const model = (blocks: Block[], extra: Partial<DocModel> = {}): DocModel => ({
  kind: "document",
  format: "docx",
  formatName: "Word document",
  textOnly: false,
  title: "",
  sections: [
    {
      width: 612,
      height: 792,
      margins: { top: 72, right: 72, bottom: 72, left: 72, header: 36, footer: 36 },
      header: [para("Header text")],
      footer: [],
      blocks,
    },
  ],
  notes: [],
  comments: [
    { id: "c1", author: "Ana Lee", date: "2026-10-01T09:00:00Z", blocks: [para("Check this.")] },
  ],
  ...extra,
});

const DOC = model([
  para("Intro", { level: 1 }),
  para("A needle, then another needle."),
  { type: "pagebreak" },
  para("Part two", { level: 2 }),
  {
    type: "paragraph",
    inlines: [
      { type: "text", text: "commented words", comments: ["c1"] },
      { type: "text", text: " and a needle." },
    ],
  },
]);

const shown = (doc: DocModel | import("../ui/model.js").Details) => ({
  buffer: "file:~/a.docx",
  path: "~/Documents/a.docx",
  name: "a.docx",
  size: 2048,
  doc,
});

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
const $$ = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector));
const press = (key: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

let view: ReturnType<typeof createView>;
beforeEach(() => {
  document.documentElement.innerHTML = html
    .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/, "");
  view = createView(document);
});

describe("the page view", () => {
  it("draws pages at the section's size and starts a page at a page break", async () => {
    await view.show(shown(DOC));
    const pages = $$(".page");
    expect(pages).toHaveLength(2);
    expect(pages[0]?.style.width).toBe("612pt");
    expect(pages[0]?.style.minHeight).toBe("792pt");
    expect(pages.map((p) => p.querySelector(".page-header")?.textContent)).toEqual([
      "Header text",
      "Header text",
    ]);
    expect(pages[1]?.querySelector(".page-body")?.textContent).toContain("Part two");
    expect($("#doc-name").textContent).toBe("a.docx");
    expect($("#doc-format").textContent).toBe("Word document");
    expect($("#doc-badge").hidden).toBe(true);
  });

  it("the outline lists the headings and scrolls to one", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    await view.show(shown(DOC));
    const buttons = $$("#outline-list button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Intro", "Part two"]);
    expect(buttons[1]?.closest("li")?.dataset.level).toBe("2");
    buttons[1]?.click();
    expect(scrolled.at(-1)?.textContent).toBe("Part two");
    expect(scrolled.at(-1)?.closest(".page")).toBe($$(".page")[1]);
  });

  it("selecting a comment highlights its range in the page", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await view.show(shown(DOC));
    expect($("#comments").hidden).toBe(false);
    const [comment] = $$("#comment-list button");
    expect(comment?.textContent).toContain("Ana Lee");
    expect(comment?.textContent).toContain("Check this.");
    comment?.click();
    const marked = $$(".is-selected");
    expect(marked.map((m) => m.textContent)).toEqual(["commented words"]);
    expect(comment?.getAttribute("aria-pressed")).toBe("true");
  });

  it("Mod+F finds in the text and Mod+G goes to the next match", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await view.show(shown(DOC));
    const open = press("f", { metaKey: true });
    expect(open.defaultPrevented).toBe(true);
    const input = $<HTMLInputElement>("#find-text");
    expect($("#find").hidden).toBe(false);
    expect(document.activeElement).toBe(input);
    input.value = "NEEDLE";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect($$("mark.find-hit")).toHaveLength(3);
    expect($("#find-count").textContent).toBe("1 of 3");
    expect($$("mark.find-hit.is-current").map((m) => m.textContent)).toEqual(["needle"]);
    expect(press("g", { metaKey: true }).defaultPrevented).toBe(true);
    expect($("#find-count").textContent).toBe("2 of 3");
    press("g", { metaKey: true, shiftKey: true });
    expect($("#find-count").textContent).toBe("1 of 3");
    press("Escape");
    expect($("#find").hidden).toBe(true);
    expect($$("mark.find-hit")).toHaveLength(0);
    expect($(".page-body")?.textContent).toContain("A needle, then another needle.");
  });

  it("zoom changes the scale, and desk chords are left alone", async () => {
    await view.show(shown(DOC));
    const sheet = $("#sheet");
    expect(press("=", { metaKey: true }).defaultPrevented).toBe(true);
    expect(sheet.style.zoom).toBe("1.1");
    expect($("#zoom-level").textContent).toBe("110%");
    press("-", { ctrlKey: true });
    press("-", { ctrlKey: true });
    expect(sheet.style.zoom).toBe("0.9");
    press("0", { metaKey: true });
    expect(sheet.style.zoom).toBe("1");
    $("#zoom-in").click();
    expect($("#zoom-level").textContent).toBe("110%");
    for (const chord of ["s", "o", "w", "k"])
      expect(press(chord, { metaKey: true }).defaultPrevented, chord).toBe(false);
  });

  it("text only documents say so in the header", async () => {
    await view.show(shown(model([para("Plain")], { textOnly: true, comments: [] })));
    expect($("#doc-badge").hidden).toBe(false);
    expect($("#comments").hidden).toBe(true);
  });

  it("file text is only ever text, and links never navigate the frame", async () => {
    const hostile = model([
      para('<img src=x onerror="alert(1)">'),
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "safe", link: "https://example.com/" },
          { type: "text", text: "script", link: "javascript:alert(1)" },
        ],
      },
    ]);
    await view.show(shown(hostile));
    expect($$(".page img")).toHaveLength(0);
    expect($(".page-body")?.textContent).toContain('<img src=x onerror="alert(1)">');
    const links = $$(".page a");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/"]);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[0]?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("the details view shows the name, size, format and why", async () => {
    await view.show(
      shown({
        kind: "details",
        format: "docx",
        formatName: "Word document",
        reason: "This document is encrypted.",
      }),
    );
    expect($("#layout").hidden).toBe(true);
    expect($("#details").hidden).toBe(false);
    expect($("#details-reason").textContent).toBe("This document is encrypted.");
    expect($("#details-facts").textContent).toContain("2 KB");
    expect($("#details-facts").textContent).toContain("Word document");
    await view.show(null);
    expect($("#doc-name").textContent).toBe("No document open");
    expect($("#details").hidden).toBe(true);
  });
});
