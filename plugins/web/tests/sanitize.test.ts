// @vitest-environment jsdom
// The sanitizer is the boundary between a saved page and the plugin's grants (ADR 0044): the frame
// runs inline scripts, so anything executable that reached the shadow root would run as the plugin.
// jsdom runs scripts here too, so a survivor also shows as a call to alert.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preparePage } from "../ui/page.js";
import { sanitizeHtml } from "../ui/sanitize.js";
import { VECTORS } from "./xss-vectors";

const BANNED = new Set([
  "script",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "param",
  "base",
  "meta",
  "link",
  "foreignobject",
  "animate",
  "set",
  "animatemotion",
  "animatetransform",
  "annotation-xml",
  "audio",
  "source",
]);
const URL_ATTRS = new Set(["href", "src", "poster", "background", "data", "codebase", "action"]);
const SAFE_LINK = /^(https?:|mailto:|file:|#)/i;
const IMAGE_DATA = /^data:image\/[a-z0-9.+-]+[;,]/i;
const BAD_CSS =
  /expression|javascript|vbscript|@import|binding|behavior|:host|url\((?!\s*["']?(data:image\/|#))/i;

/** Everything in a sanitized tree that could run a script or reach the network. */
function problems(root: ParentNode): string[] {
  const found: string[] = [];
  for (const el of root.querySelectorAll("*")) {
    const name = el.localName.toLowerCase();
    if (BANNED.has(name)) found.push(`<${name}>`);
    if (name === "style" && BAD_CSS.test(el.textContent ?? ""))
      found.push(`<style>${el.textContent}`);
    for (const attr of el.attributes) {
      const attrName = attr.name.toLowerCase();
      const value = attr.value;
      if (attrName.startsWith("on")) found.push(`${name}[${attrName}]`);
      if (["srcdoc", "formaction", "srcset", "autofocus", "target"].includes(attrName))
        found.push(`${name}[${attrName}]`);
      if (attrName === "style" && BAD_CSS.test(value)) found.push(`${name}[style=${value}]`);
      const local = attrName.replace(/^xlink:/, "");
      if (!URL_ATTRS.has(local)) continue;
      const ok =
        local === "href" && el.namespaceURI === "http://www.w3.org/1999/xhtml"
          ? SAFE_LINK.test(value)
          : local === "href"
            ? value.startsWith("#") || IMAGE_DATA.test(value)
            : IMAGE_DATA.test(value);
      if (!ok) found.push(`${name}[${attrName}=${value}]`);
    }
  }
  return found;
}

const EVENTS = ["error", "load", "click", "mouseover", "focus", "toggle", "begin", "submit"];

/** Put the tree in the live document's shadow root and fire what the vectors listen for. */
function run(fragment: DocumentFragment) {
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(fragment);
  for (const el of shadow.querySelectorAll("*"))
    for (const type of EVENTS) el.dispatchEvent(new Event(type, { bubbles: false }));
  return shadow;
}

const nothing = { base: "file:///~/Sites/page.html", load: async () => "missing" as const };

let alerts: ReturnType<typeof vi.fn>;
beforeEach(() => {
  alerts = vi.fn();
  window.alert = alerts;
  document.body.replaceChildren();
});
afterEach(() => vi.restoreAllMocks());

describe("the sanitizer against known XSS vectors", () => {
  it("has at least 40 of them", () => {
    expect(VECTORS.length).toBeGreaterThanOrEqual(40);
  });

  it.each(VECTORS)("%s leaves nothing executable", async (_name, html) => {
    const alone = run(sanitizeHtml(html, document));
    expect(problems(alone)).toEqual([]);
    const page = await preparePage({ text: html, mime: "text/html", resolver: nothing }, document);
    const drawn = run(page.root);
    expect(problems(drawn)).toEqual([]);
    expect(alerts).not.toHaveBeenCalled();
  });

  it("XHTML parsed as XML gets the same treatment", async () => {
    const xhtml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:svg="http://www.w3.org/2000/svg"><head><title>X</title></head><body>
      <script>alert(1)</script><p onclick="alert(1)">text</p>
      <svg:svg><svg:script>alert(1)</svg:script><svg:circle r="4"/></svg:svg>
      <a href="javascript:alert(1)">x</a></body></html>`;
    const page = await preparePage(
      { text: xhtml, mime: "application/xhtml+xml", resolver: nothing },
      document,
    );
    const drawn = run(page.root);
    expect(problems(drawn)).toEqual([]);
    expect(drawn.querySelector("p")?.textContent).toBe("text");
    expect(drawn.querySelector("circle")?.getAttribute("r")).toBe("4");
    expect(alerts).not.toHaveBeenCalled();
  });

  it("forms show but cannot submit", () => {
    const tree = run(
      sanitizeHtml(
        '<form action="https://example.com/post" method="post"><input name="q" value="v"><button>Go</button></form>',
        document,
      ),
    );
    const form = tree.querySelector("form");
    expect(form?.hasAttribute("action")).toBe(false);
    expect(form?.hasAttribute("method")).toBe(false);
    expect(tree.querySelector("input")?.getAttribute("value")).toBe("v");
    expect(tree.querySelector("button")?.textContent).toBe("Go");
  });
});

describe("ordinary markup survives", () => {
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const ORDINARY = `
    <h1 id="top" class="title">Title</h1>
    <p lang="ko" dir="ltr">안녕 <b>bold</b> <i>it</i> <code>code</code> <a href="https://example.com/a?b=c">out</a>
      <a href="#top">up</a> <a href="mailto:someone@example.com">mail</a></p>
    <table border="1"><caption>T</caption><thead><tr><th scope="col">H</th></tr></thead>
      <tbody><tr><td colspan="2" rowspan="1">cell</td></tr></tbody></table>
    <ul><li>one</li></ul><ol start="3"><li value="5">three</li></ol>
    <dl><dt>term</dt><dd>definition</dd></dl>
    <figure><img src="${PNG}" alt="dot" width="10" height="10"><figcaption>A dot</figcaption></figure>
    <svg viewBox="0 0 10 10" width="10" height="10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>
      <circle cx="5" cy="5" r="4" fill="url(#g)"/><path d="M0 0L10 10" stroke="black"/><text x="1" y="9">S</text></svg>
    <details open><summary>More</summary><pre>pre  text</pre></details>
    <blockquote>quote</blockquote><hr><p style="color: red; margin: 0 auto">styled</p>`;

  it("keeps structure, text, safe links, images and drawings", () => {
    const tree = run(sanitizeHtml(ORDINARY, document));
    expect(problems(tree)).toEqual([]);
    expect(tree.querySelector("h1#top.title")?.textContent).toBe("Title");
    expect(tree.querySelector("p[lang=ko]")?.textContent).toContain("안녕 bold it code out");
    const hrefs = [...tree.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.com/a?b=c", "#top", "mailto:someone@example.com"]);
    expect(tree.querySelector("td")?.getAttribute("colspan")).toBe("2");
    expect(tree.querySelector("th")?.getAttribute("scope")).toBe("col");
    expect(tree.querySelector("caption")?.textContent).toBe("T");
    expect(tree.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(tree.querySelectorAll("li")).toHaveLength(2);
    expect(tree.querySelector("dd")?.textContent).toBe("definition");
    expect(tree.querySelector("figure img")?.getAttribute("src")).toBe(PNG);
    expect(tree.querySelector("figcaption")?.textContent).toBe("A dot");
    const svg = tree.querySelector("svg");
    expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(tree.querySelector("linearGradient stop")?.getAttribute("stop-color")).toBe("red");
    expect(tree.querySelector("circle")?.getAttribute("fill")).toBe("url(#g)");
    expect(tree.querySelector("path")?.getAttribute("d")).toBe("M0 0L10 10");
    expect(tree.querySelector("text")?.textContent).toBe("S");
    expect(tree.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(tree.querySelector("pre")?.textContent).toBe("pre  text");
    expect(tree.querySelector("blockquote")?.textContent).toBe("quote");
    expect(tree.querySelector("p[style]")?.getAttribute("style")).toMatch(/color: ?red/);
  });

  it("the page keeps its text when its scripts never run", async () => {
    const html = `<!doctype html><html lang="en"><head><title>App</title>
      <script>document.write("built by script")</script></head>
      <body class="home"><div id="root"><p>Static text</p></div>
      <script src="app.js"></script></body></html>`;
    const page = await preparePage({ text: html, mime: "text/html", resolver: nothing }, document);
    const drawn = run(page.root);
    expect(page.title).toBe("App");
    expect(drawn.querySelector("web-html")?.getAttribute("lang")).toBe("en");
    expect(drawn.querySelector("web-body")?.getAttribute("class")).toBe("home");
    expect(drawn.textContent).toContain("Static text");
    expect(drawn.textContent).not.toContain("built by script");
  });
});
