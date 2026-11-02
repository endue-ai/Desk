// @vitest-environment jsdom
// A document's links: http, https and mailto open with shell.open under one shell:open grant;
// javascript:, file: and other schemes open nothing; note references keep jumping in the page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DocModel } from "../ui/model.js";
import { createView } from "../ui/view/view.js";
import { disk, file, mount } from "./harness";
import { utf8 } from "./zip";

const SCOPE = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
const A = file("~/Documents/a.rtf");

const linked = (link: string) => ({ type: "text" as const, text: link, link });
const DOC: DocModel = {
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
      blocks: [
        {
          type: "paragraph",
          inlines: [
            linked("https://example.com/report"),
            linked("mailto:team@example.com"),
            linked("javascript:alert(1)"),
            linked("file:///etc/hosts"),
            { type: "noteref", note: "n1", label: "1" },
          ],
        },
      ],
    },
  ],
  notes: [{ id: "n1", kind: "footnote", label: "1", blocks: [] }],
  comments: [],
};

function page() {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  const external = vi.fn();
  const view = createView(document, { external });
  return { view, external };
}

describe("links in the page", () => {
  it("a hyperlink goes to the plugin with its URL, by mouse or keyboard, and never navigates", async () => {
    const { view, external } = page();
    await view.show({ buffer: "b", path: "~/a.docx", name: "a.docx", size: 1, doc: DOC });
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".page a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/report",
      "mailto:team@example.com",
    ]);
    // An anchor with an href is in the tab order, and Enter on it is a click.
    expect(links.every((a) => a.tabIndex === 0)).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[0]?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    links[1]?.click();
    expect(external.mock.calls).toEqual([
      ["https://example.com/report"],
      ["mailto:team@example.com"],
    ]);
  });

  it("a note reference keeps jumping inside the document and opens nothing", async () => {
    const { view, external } = page();
    await view.show({ buffer: "b", path: "~/a.docx", name: "a.docx", size: 1, doc: DOC });
    const note = document.getElementById("docs-note-n1") as HTMLElement;
    note.scrollIntoView = vi.fn();
    document.querySelector<HTMLButtonElement>(".noteref")?.click();
    await vi.waitFor(() => expect(note.scrollIntoView).toHaveBeenCalled());
    expect(external).not.toHaveBeenCalled();
  });
});

describe("opening a link", () => {
  it("runs shell.open with the URL and the shell:open scope; one grant covers every link", async () => {
    const prompt = vi.fn(() => true);
    const { app, params, host } = await mount({ handlers: disk({}), prompt });
    await app.external("https://example.com/report");
    await app.external("mailto:team@example.com");
    expect(params("shell.open")).toEqual([
      { target: "https://example.com/report", scope: SCOPE },
      { target: "mailto:team@example.com", scope: SCOPE },
    ]);
    expect(prompt).toHaveBeenCalledOnce();
    expect(host.calls.some((c) => c.method === "perm.request")).toBe(false);
  });

  it("javascript:, file:, data:, ftp: and a bookmark open nothing", async () => {
    const { app, params } = await mount({ handlers: disk({}) });
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/hosts",
      "data:text/html,<b>x</b>",
      "ftp://example.com/",
      "#_Toc1",
      "not a url",
    ])
      await app.external(url);
    expect(params("shell.open")).toEqual([]);
  });

  it("a refusal is said on the status line, with no second ask and no retry", async () => {
    const { app, params, view, host } = await mount({
      handlers: disk({ [A.path]: utf8("{\\rtf1 x}") }),
      prompt: () => false,
    });
    await app.external("https://example.com/report");
    expect(params("shell.open")).toHaveLength(1);
    expect(host.calls.some((c) => c.method === "perm.request")).toBe(false);
    expect(view.statuses.at(-1)).toBe("Could not open https://example.com/report: not allowed.");
  });
});
