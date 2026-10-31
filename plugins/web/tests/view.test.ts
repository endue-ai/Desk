// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createView } from "../ui/view.js";
import { disk, file, loadPage, mount } from "./harness";

const PAGE = file("~/Sites/index.html");
const HTML = `<!doctype html>
<html><head><title>Home</title></head>
<body><p><a href="#part">jump</a> <a href="other.html#top">other</a>
<a href="https://example.com/x?y=1">outside</a></p>
<img src="https://example.com/remote.png" alt="remote">
<h2 id="part">Part</h2></body></html>`;

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const shadow = () => byId("page").shadowRoot as ShadowRoot;

async function open(files: Record<string, string> = { [PAGE.path]: HTML }) {
  const mounted = await mount({
    handlers: disk(files),
    view: (actions) => createView(document, actions),
  });
  await mounted.host.command("desk.files.visit", PAGE);
  await mounted.settle();
  return mounted;
}

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("nothing to click");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  loadPage(document);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the page view", () => {
  it("draws the page in a shadow root under the file's name", async () => {
    await open();
    expect(byId("file-name").textContent).toBe("index.html");
    expect(byId("file-detail").textContent).toContain("HTML page");
    expect(shadow().querySelector("h2")?.textContent).toBe("Part");
    expect(byId("page").hidden).toBe(false);
  });

  it("the source toggle shows the file's text with line numbers and tag colours", async () => {
    await open();
    const toggle = byId("source-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const source = byId("source");
    expect(source.hidden).toBe(false);
    expect(byId("page").hidden).toBe(true);
    const numbers = [...source.querySelectorAll(".line-number")].map((n) => n.textContent);
    expect(numbers.slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(source.textContent).toContain("<title>Home</title>");
    expect([...source.querySelectorAll(".tag")].map((t) => t.textContent)).toContain("<title");
    click(toggle);
    expect(source.hidden).toBe(true);
    expect(byId("page").hidden).toBe(false);
  });

  it("a fragment link scrolls within the page", async () => {
    const { ran } = await open();
    const event = click(shadow().querySelector('a[href="#part"]'));
    expect(event.defaultPrevented).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    const target = vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0] as Element;
    expect(target.id).toBe("part");
    expect(ran("desk.files.open")).toEqual([]);
  });

  it("a relative link to another local page opens it with desk.files.open", async () => {
    const { ran, settle } = await open();
    const event = click(shadow().querySelector("a[href*='other.html']"));
    expect(event.defaultPrevented).toBe(true);
    await settle();
    expect(ran("desk.files.open")).toEqual([{ path: "~/Sites/other.html" }]);
  });

  it("an external link shows its URL on the status line and opens nothing", async () => {
    const { ran, settle } = await open();
    const event = click(shadow().querySelector("a[href^='https:']"));
    expect(event.defaultPrevented).toBe(true);
    await settle();
    expect(byId("status").textContent).toBe("https://example.com/x?y=1");
    expect(ran("desk.files.open")).toEqual([]);
  });

  it("a bar says how many remote resources were left out", async () => {
    await open();
    const bar = byId("bar");
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toBe(
      "1 remote resource was not loaded: Web does not reach the network.",
    );
  });

  it("a page with no remote resources shows no bar", async () => {
    await open({ [PAGE.path]: "<p>Only text</p>" });
    expect(byId("bar").hidden).toBe(true);
  });
});
