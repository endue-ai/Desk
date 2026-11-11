// @vitest-environment jsdom
// What fits a small window (#160, finding 10), on the page and stylesheet as the desk serves them:
// the commit editor shrinks and scrolls inside its view instead of running under the footer, and
// says its keys once (in the footer); the empty state wraps; the hint line leads with `? keys`, and
// `?` opens the whole list of keys, wrapped, until `?` again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { hints } from "../ui/keys.js";
import { emptyStatus } from "../ui/parse-status.js";
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

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const style = (el: Element) => getComputedStyle(el);
const EMPTY = { repo: null, status: emptyStatus(), stashes: [], recent: [] };

describe("Git in a small window", () => {
  beforeEach(() => loadPage(document));

  it("the commit editor may shrink below its content and scrolls instead of overflowing", () => {
    const view = createView(document, () => undefined);
    view.show("commit", hints("commit"));
    const form = byId("commit");
    expect(Number.parseFloat(style(form).minHeight)).toBe(0);
    expect(style(form).overflow).toBe("auto");
    // The message keeps three lines (4.5em) at least, no longer a fixed 120 px that outgrew the view.
    const least = Number.parseFloat(style(byId("commit-message")).minHeight);
    expect(least).toBeGreaterThan(0);
    expect(least).toBeLessThan(120);
    expect(form.querySelector(".hint")).toBeNull();
    expect(byId("hints").textContent).toBe("Mod+Enter commit · Escape cancel");
  });

  it("the empty state wraps instead of running out of the window", () => {
    const view = createView(document, () => undefined);
    view.status(EMPTY);
    view.show("status", hints("status"));
    const empty = document.querySelector(".row.empty");
    expect(empty?.textContent).toMatch(/^No repository open/);
    expect(style(empty as Element).whiteSpace).toBe("normal");
  });

  it("the hint line leads with ? keys, and ? opens and closes the whole list", () => {
    const view = createView(document, () => undefined);
    view.status(EMPTY);
    view.show("status", hints("status"));
    const line = byId("hints");
    expect(line.textContent).toMatch(/^\? keys · s stage/);
    expect(style(line).whiteSpace).toBe("nowrap");
    const key = (value: string) =>
      byId("view").dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
    key("?");
    expect(line.dataset.open).toBe("");
    expect(style(line).whiteSpace).toBe("normal");
    // Each binding stays whole on its line.
    const bindings = [...line.querySelectorAll(".binding")].map((el) => el.textContent);
    expect(bindings).toContain("b switch branch");
    expect(style(line.querySelector(".binding") as Element).whiteSpace).toBe("nowrap");
    key("?");
    expect(line.dataset.open).toBeUndefined();
    expect(style(line).whiteSpace).toBe("nowrap");
  });
});
