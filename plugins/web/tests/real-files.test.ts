// @vitest-environment jsdom
// Files made by real tools (tests/fixtures/real.sh): Blink's MHTML and DOM dump, GNU Wget's WARC
// (one gzip member per record) and a shortcut written by pylnk3.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { preparePage } from "../ui/page.js";
import { fixture } from "./harness";

const site = join(import.meta.dirname, "fixtures/site");
const sun = `data:image/png;base64,${readFileSync(join(site, "assets/sun.png")).toString("base64")}`;
/** The sample site, as the disk around ~/Site. */
const disk = {
  read: async (path: string) => {
    if (!path.startsWith("~/Site/")) return null;
    try {
      return new Uint8Array(readFileSync(join(site, path.slice("~/Site/".length))));
    } catch {
      return null;
    }
  },
};

async function drawn(page: Parameters<typeof preparePage>[0]) {
  const prepared = await preparePage(page, document);
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).append(prepared.root);
  const shadow = host.shadowRoot as ShadowRoot;
  const css = [...shadow.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  return { prepared, shadow, css };
}

describe("files made by real tools", () => {
  it("an MHTML page saved by Blink (Chrome's Page.captureSnapshot)", async () => {
    const model = await openFile(fixture("blink.mhtml"), "~/Saved/sample.mhtml", disk);
    if (model.kind !== "page") throw new Error(model.kind);
    const { prepared, shadow, css } = await drawn(model.page);
    expect(prepared.title).toBe("changed by script");
    expect(shadow.querySelector("h1")?.textContent).toBe("A sample saved page");
    expect(shadow.querySelector("img[alt='A sun']")?.getAttribute("src")).toBe(sun);
    expect(css).toContain("web-html { font-family: Georgia, serif;");
    expect(css).toMatch(/web-body \{ max-width: 720px; .*url\("data:image\/jpeg;base64,/);
    expect(shadow.textContent).toContain("한국어 텍스트도 있습니다.");
    expect(prepared.left).toEqual({ remote: 1, missing: 0, limit: 0 });
  });

  it("the DOM Chrome dumped, next to the files it uses", async () => {
    const bytes = fixture("site/saved-by-chrome.html");
    const model = await openFile(bytes, "~/Site/saved-by-chrome.html", disk);
    if (model.kind !== "page") throw new Error(model.kind);
    const { prepared, shadow, css } = await drawn(model.page);
    expect(shadow.querySelector("script")).toBeNull();
    expect(shadow.querySelector("img[alt='A sun']")?.getAttribute("src")).toBe(sun);
    expect(shadow.querySelector("circle")?.getAttribute("fill")).toBe("#e05050");
    expect(css).toContain("web-html { font-family: Georgia, serif; color: #223; }");
    expect(prepared.left).toEqual({ remote: 1, missing: 0, limit: 0 });
  });

  it("a WARC written by GNU Wget: every record, the pages drawn from the archive", async () => {
    const model = await openFile(fixture("wget.warc.gz"), "~/Saved/wget.warc.gz", disk);
    if (model.kind !== "entries") throw new Error(model.kind);
    expect(model.entries.length).toBeGreaterThanOrEqual(14);
    expect(model.entries[0]?.detail).toBe("warcinfo · application/warc-fields");
    const pages = model.entries.filter((e) => e.page).map((e) => e.title);
    expect(pages).toEqual(["http://127.0.0.1:8000/index.html", "http://127.0.0.1:8000/other.html"]);
    const index = model.entries[model.selected]?.page;
    if (!index) throw new Error("no page selected");
    const { shadow, css, prepared } = await drawn(index);
    expect(shadow.querySelector("img[alt='A sun']")?.getAttribute("src")).toBe(sun);
    expect(css).toContain("h1 { color: #2a5ca8; }");
    expect(prepared.left).toEqual({ remote: 1, missing: 0, limit: 0 });
    const robots = model.entries.find(
      (e) => e.title.endsWith("/robots.txt") && e.detail?.startsWith("response"),
    );
    expect(robots?.text).toContain("404");
  });

  it("a shortcut written by pylnk3, with only an ID list for its target", async () => {
    const model = await openFile(fixture("pylnk3.lnk"), "~/Desktop/report.lnk", disk);
    expect(model).toMatchObject({
      kind: "card",
      title: "Quarterly report",
      fields: [
        ["Target", "C:\\Users\\Public\\Documents\\report.txt"],
        ["Arguments", "/view"],
        ["Working folder", "C:\\Users\\Public\\Documents"],
        ["Description", "Quarterly report"],
      ],
    });
  });
});
