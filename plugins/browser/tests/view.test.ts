// @vitest-environment jsdom
// The Browser's page (ui/index.html + ui/view.js): the toolbar's buttons, the address field and
// the box the web page is drawn over.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const idle = { url: "", loading: false, canGoBack: false, canGoForward: false };

function mount() {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const on = {
    go: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    resized: vi.fn(),
  };
  return { on, view: createView(document, on) };
}

const key = (name: string) =>
  byId("address").dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));

describe("the Browser's page", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
  });

  it("has no form: a plugin's frame submits none", () => {
    mount();
    expect(document.querySelector("form")).toBeNull();
  });

  it("goes where the address field says on Enter, and leaves the field to the page", () => {
    const { on } = mount();
    const address = byId<HTMLInputElement>("address");
    address.focus();
    address.value = "example.com";
    key("Enter");
    expect(on.go).toHaveBeenCalledWith("example.com");
    expect(document.activeElement).not.toBe(address);
  });

  it("enables back and forward as the history allows, and turns reload into stop while loading", () => {
    const { on, view } = mount();
    const [back, forward, reload] = ["back", "forward", "reload"].map((id) =>
      byId<HTMLButtonElement>(id),
    );
    view.shows({ ...idle, url: "https://example.com/", canGoBack: true });
    expect([back?.disabled, forward?.disabled]).toEqual([false, true]);
    reload?.click();
    expect(on.reload).toHaveBeenCalledTimes(1);
    view.shows({ ...idle, url: "https://example.com/", loading: true });
    expect(reload?.getAttribute("aria-label")).toBe("Stop");
    reload?.click();
    expect(on.stop).toHaveBeenCalledTimes(1);
    back?.click();
    expect(on.back).not.toHaveBeenCalled();
  });

  it("shows the page's address, but keeps what the person is typing; Escape puts it back", () => {
    const { view } = mount();
    const address = byId<HTMLInputElement>("address");
    view.shows({ ...idle, url: "https://example.com/a" });
    expect(address.value).toBe("https://example.com/a");
    address.focus();
    address.value = "typing";
    view.shows({ ...idle, url: "https://example.com/b" });
    expect(address.value).toBe("typing");
    key("Escape");
    expect(address.value).toBe("https://example.com/b");
  });

  it("says where the page lies in whole pixels, and a note under it", () => {
    const { view } = mount();
    byId("page").getBoundingClientRect = () =>
      ({ left: 0.4, top: 40.6, right: 800.4, bottom: 599.5 }) as DOMRect;
    expect(view.box()).toEqual({ x: 0, y: 41, width: 800, height: 559 });
    view.note("A web page shows in the desk only.");
    expect(byId("note").textContent).toBe("A web page shows in the desk only.");
  });
});
