// @vitest-environment jsdom
// Plugins' places while their windows lie in pages of their own (ADR 0201): one group a window in the
// desk's page, led by a stop for the window's chrome, so Shift+Tab out of a plugin stops at its own
// window's chrome and Tab past it at the next window's, as when the windows lay in the page.
import { afterEach, describe, expect, it } from "vitest";
import { surfaceAnchors } from "./anchors";

/** A window's section named `name`, its body holding plugin `plugin`'s section. */
function window(id: string, name: string, plugin: string) {
  const el = document.createElement("section");
  el.setAttribute("aria-label", name);
  el.innerHTML = `<header><button>a</button></header><div class="body"><div class="desk-surface"
    data-surface="${plugin}"><div data-surface-host="h" tabindex="-1"></div></div></div>`;
  document.body.append(el);
  return { id, el, body: el.querySelector<HTMLElement>(".body") as HTMLElement };
}

/** The desk page's focus order under `root`: tabbable elements and places, in tree order. */
const order = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("[tabindex]")].map(
    (e) =>
      e.getAttribute("aria-label") ?? e.closest("[data-surface]")?.getAttribute("data-surface"),
  );

describe("surface anchors", () => {
  afterEach(() => document.body.replaceChildren());

  it("keep each window's plugin places in a group of its own, after a stop for its chrome", () => {
    const layer = document.createElement("div");
    document.body.append(layer);
    const anchors = surfaceAnchors(layer);
    const a = window("a", "Notes", "p.a");
    const b = window("b", "Mail", "p.b");
    anchors.hold(a.id, a.el, a.body);
    anchors.hold(b.id, b.el, b.body);
    // Shift+Tab from p.a's place stops at Notes' chrome, not in p.b; Tab past p.a stops at Mail's.
    expect(order(layer)).toEqual(["Notes", "p.a", "Mail", "p.b"]);
    expect(a.body.querySelector(".desk-surface")).toBeNull();
  });

  it("name a window's stop as the window is named now", () => {
    const layer = document.createElement("div");
    document.body.append(layer);
    const anchors = surfaceAnchors(layer);
    const a = window("a", "Notes", "p.a");
    anchors.hold(a.id, a.el, a.body);
    a.el.setAttribute("aria-label", "Notes — today");
    anchors.hold(a.id, a.el, a.body);
    expect(order(layer)[0]).toBe("Notes — today");
  });

  it("make no group for a window without plugins, and drop a window's group with it", () => {
    const layer = document.createElement("div");
    document.body.append(layer);
    const anchors = surfaceAnchors(layer);
    const bare = document.createElement("section");
    anchors.hold("bare", bare, bare);
    expect(layer.querySelectorAll(".surface-anchor")).toHaveLength(0);
    const a = window("a", "Notes", "p.a");
    anchors.hold(a.id, a.el, a.body);
    anchors.drop("a");
    expect(layer.querySelectorAll(".surface-anchor")).toHaveLength(0);
  });
});
