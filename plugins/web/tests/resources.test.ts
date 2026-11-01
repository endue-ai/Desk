// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { BUDGET, preparePage } from "../ui/page.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const dataUrl = (type: string, bytes: Uint8Array) =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

/** A folder on disk: read answers what is there and records what was asked for. */
function folder(files: Record<string, Uint8Array | string>) {
  const asked: string[] = [];
  const read = async (path: string) => {
    asked.push(path);
    const content = files[path];
    if (content === undefined) return null;
    return typeof content === "string" ? utf8(content) : content;
  };
  return { asked, read };
}

async function draw(path: string, html: string, files: Record<string, Uint8Array | string>) {
  const disk = folder(files);
  const model = await openFile(utf8(html), path, { read: disk.read });
  if (model.kind !== "page") throw new Error(`not a page: ${model.kind}`);
  const page = await preparePage(model.page, document);
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).append(page.root);
  const shadow = host.shadowRoot as ShadowRoot;
  const css = [...shadow.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  return { page, shadow, css, asked: disk.asked };
}

describe("resources a saved page uses", () => {
  it("inlines a relative stylesheet with its @import, and a relative image", async () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="css/site.css">
      <style>body { margin: 2px } :root { --gap: 4px }</style></head>
      <body><img src="img/dot.png" alt="dot"><p class="hero">Hi</p></body></html>`;
    const { page, shadow, css, asked } = await draw("~/Sites/my page/index.html", html, {
      "~/Sites/my page/css/site.css":
        '@import "base.css";\n.hero { background: url(../img/bg.gif) }',
      "~/Sites/my page/css/base.css": "html { color: rgb(1, 2, 3) }",
      "~/Sites/my page/img/dot.png": PNG,
      "~/Sites/my page/img/bg.gif": GIF,
    });
    expect(shadow.querySelector("img")?.getAttribute("src")).toBe(dataUrl("image/png", PNG));
    expect(css).toContain("web-html { color: rgb(1, 2, 3) }");
    expect(css).toContain(`.hero { background: url("${dataUrl("image/gif", GIF)}") }`);
    expect(css).toContain("web-body { margin: 2px }");
    expect(css).toContain("web-html { --gap: 4px }");
    expect(css).not.toMatch(/@import|<link/);
    expect(asked).toEqual([
      "~/Sites/my page/css/site.css",
      "~/Sites/my page/css/base.css",
      "~/Sites/my page/img/bg.gif",
      "~/Sites/my page/img/dot.png",
    ]);
    expect(page.left).toEqual({ remote: 0, missing: 0, limit: 0 });
  });

  it("follows @import three levels deep and no further", async () => {
    const html = '<link rel="stylesheet" href="a.css"><p>x</p>';
    const { css, page } = await draw("~/Sites/page.html", html, {
      "~/Sites/a.css": '@import "b.css"; .a { color: red }',
      "~/Sites/b.css": '@import "c.css"; .b { color: red }',
      "~/Sites/c.css": '@import "d.css"; .c { color: red }',
      "~/Sites/d.css": '@import "e.css"; .d { color: red }',
      "~/Sites/e.css": ".e { color: red }",
    });
    expect(css).toMatch(/\.a \{/);
    expect(css).toMatch(/\.d \{/);
    expect(css).not.toMatch(/\.e \{/);
    expect(page.left.limit).toBe(1);
  });

  it("leaves remote images and stylesheets out, counts them and never reads them", async () => {
    const html = `<link rel="stylesheet" href="https://cdn.example.com/site.css">
      <img src="https://example.com/a.png"><img src="//cdn.example.com/b.png">
      <img src="http://example.com/a.png?again"><div style="background: url(https://example.com/c.png) red">x</div>
      <img src="missing.png">`;
    const { shadow, css, page, asked } = await draw("~/Sites/page.html", html, {});
    const srcs = [...shadow.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toEqual([null, null, null, null]);
    expect(shadow.querySelector("div")?.getAttribute("style")).toBe("background: none red");
    expect(css).not.toContain("cdn.example.com");
    expect(page.left).toEqual({ remote: 5, missing: 1, limit: 0 });
    expect(asked).toEqual(["~/Sites/missing.png"]);
  });

  it("holds the 20 MB cap", async () => {
    expect(BUDGET).toBe(20 * 1024 * 1024);
    const big = new Uint8Array(8 * 1024 * 1024);
    big.set(PNG.subarray(0, 8));
    const html = '<img src="1.png"><img src="2.png"><img src="3.png"><img src="dot.png">';
    const { shadow, page } = await draw("~/Sites/page.html", html, {
      "~/Sites/1.png": big,
      "~/Sites/2.png": big,
      "~/Sites/3.png": big,
      "~/Sites/dot.png": PNG,
    });
    const srcs = [...shadow.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs.map((src) => src?.slice(0, 22) ?? null)).toEqual([
      "data:image/png;base64,",
      "data:image/png;base64,",
      null,
      "data:image/png;base64,",
    ]);
    expect(page.left).toEqual({ remote: 0, missing: 0, limit: 1 });
  });

  it("rewrites html, body and :root selectors to the shadow root's wrappers", async () => {
    const html = `<style>html, body { height: 100% } html > body.dark p { color: white }
      :root { --x: 1 } .html, #body, [data-x="html"] { color: red } :is(body) { margin: 0 }
      @media print { body { color: black } }</style><body class="dark"><p>x</p></body>`;
    const { css, shadow } = await draw("~/Sites/page.html", html, {});
    expect(css).toContain("web-html, web-body { height: 100% }");
    expect(css).toContain("web-html > web-body.dark p { color: white }");
    expect(css).toContain("web-html { --x: 1 }");
    expect(css).toContain('.html, #body, [data-x="html"] { color: red }');
    expect(css).toContain(":is(web-body) { margin: 0 }");
    expect(css).toContain("@media print { web-body { color: black } }");
    expect(shadow.querySelector("web-html > web-body.dark > p")).not.toBeNull();
  });
});
