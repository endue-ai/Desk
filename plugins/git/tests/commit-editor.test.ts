// @vitest-environment jsdom
// The commit editor shows only while a commit is being written. The page's body and stylesheet are
// loaded as the desk serves them, and the view toggles the editor's `hidden` attribute; an author
// rule that sets `display` on the editor must not override it (#341).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";

const ui = (file: string) => readFileSync(join(import.meta.dirname, "../ui", file), "utf8");

function loadPage(doc: Document) {
  const html = ui("index.html");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const style = doc.createElement("style");
  style.textContent = ui("style.css");
  doc.head.replaceChildren(style);
  doc.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
}

const editor = () => document.getElementById("commit") as HTMLFormElement;
const displayed = (el: HTMLElement) => getComputedStyle(el).display !== "none";

describe("the commit editor", () => {
  beforeEach(() => loadPage(document));

  it("is not displayed while the page keeps it hidden", () => {
    expect(editor().hidden).toBe(true);
    expect(displayed(editor())).toBe(false);
  });

  it("is not displayed under the status, log or diff view", () => {
    const view = createView(document, () => undefined);
    for (const name of ["status", "log", "diff"] as const) {
      view.show(name, "");
      expect(editor().hidden).toBe(true);
      expect(displayed(editor()), name).toBe(false);
    }
  });

  it("is displayed, as a column, while a commit is being written", () => {
    const view = createView(document, () => undefined);
    view.show("commit", "");
    expect(displayed(editor())).toBe(true);
    expect(getComputedStyle(editor()).display).toBe("flex");
    view.show("log", "");
    expect(displayed(editor())).toBe(false);
  });
});
