// @vitest-environment jsdom
// The header's actions at any width (QA 06 #6): how many buttons fit before More, and the row and
// the menu kept in step, on a DOM whose widths are given (jsdom lays nothing out).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActions, fitCount } from "../ui/view-actions.js";

describe("fitCount", () => {
  it("keeps every button when they fit as they are", () => {
    expect(fitCount([60, 60, 60], 188, 4, 50)).toBe(3);
    expect(fitCount([], 0, 4, 50)).toBe(0);
  });

  it("keeps as many as fit before More, in their order", () => {
    // 50 (More) + 4 + 60 + 4 + 60 = 178; a third would need 242.
    expect(fitCount([60, 60, 60, 60], 200, 4, 50)).toBe(2);
    expect(fitCount([60, 60, 60, 60], 177, 4, 50)).toBe(1);
    expect(fitCount([60, 60], 100, 4, 50)).toBe(0);
  });
});

/** A nav of `count` buttons, each 60 px wide, More 50 px, in a row `room` px wide. */
function setup(count: number) {
  const names = ["run", "format", "cancel", "history", "star"].slice(0, count);
  document.body.innerHTML = `<nav id="actions">${names
    .map((n) => `<button data-act="${n}" title="${n} it">${n}</button>`)
    .join("")}<button id="actions-more" hidden>More</button></nav><div id="actions-menu"></div>`;
  const nav = document.getElementById("actions") as HTMLElement;
  const more = document.getElementById("actions-more") as HTMLElement;
  const menu = document.getElementById("actions-menu") as HTMLElement;
  let room = 0;
  Object.defineProperty(nav, "clientWidth", { get: () => room });
  for (const button of nav.querySelectorAll("button"))
    button.getBoundingClientRect = () =>
      ({ width: button === more ? 50 : 60, right: 400, bottom: 30 }) as DOMRect;
  nav.style.columnGap = "4px";
  const act = vi.fn();
  const row = createActions(document, { nav, more, menu }, act);
  return {
    nav,
    more,
    menu,
    act,
    fit(width: number) {
      room = width;
      row.fit();
    },
    shown: () => [...nav.querySelectorAll<HTMLElement>("[data-act]")].filter((b) => !b.hidden),
    behind: () => [...menu.children].filter((i) => !(i as HTMLElement).hidden),
  };
}

describe("the actions row", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete document.body.dataset.running;
  });

  it("mirrors every action in the menu, with its words and title, and none in [data-act]", () => {
    const { menu } = setup(3);
    expect([...menu.children].map((i) => [i.textContent, i.getAttribute("title")])).toEqual([
      ["run", "run it"],
      ["format", "format it"],
      ["cancel", "cancel it"],
    ]);
    expect(menu.querySelectorAll("[data-act]")).toHaveLength(0);
  });

  it("puts what does not fit behind More, and takes More away when all fit", () => {
    const row = setup(4);
    row.fit(200);
    expect(row.shown().map((b) => b.dataset.act)).toEqual(["run", "format"]);
    expect(row.behind().map((i) => (i as HTMLElement).dataset.action)).toEqual([
      "cancel",
      "history",
    ]);
    expect(row.more.hidden).toBe(false);
    row.fit(300);
    expect(row.shown()).toHaveLength(4);
    expect(row.behind()).toHaveLength(0);
    expect(row.more.hidden).toBe(true);
  });

  it("leaves the row as it is while it is hidden or has no room yet", () => {
    const row = setup(4);
    row.fit(0);
    expect(row.shown()).toHaveLength(4);
    expect(row.more.hidden).toBe(true);
  });

  it("runs the chosen item's action, and offers Cancel only while something runs", () => {
    const row = setup(4);
    row.fit(120);
    row.more.click();
    const cancel = row.menu.querySelector('[data-action="cancel"]') as HTMLElement;
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    document.body.dataset.running = "true";
    row.more.click();
    expect(cancel.getAttribute("aria-disabled")).toBe("false");
    const item = row.menu.querySelector('[data-action="history"]') as HTMLElement;
    row.menu.dispatchEvent(new CustomEvent("desk-select", { detail: { index: 2, item } }));
    expect(row.act).toHaveBeenCalledWith("history");
  });

  it("closes an open menu on a press on More, and does not open it again", () => {
    const row = setup(4);
    row.fit(120);
    const menu = row.menu as HTMLElement & { open?: boolean; show?(): void; close?(): void };
    menu.show = vi.fn(() => {
      menu.open = true;
    });
    // The menu closes itself on a press outside it, before More's click.
    menu.close = vi.fn(() => {
      menu.open = false;
    });
    row.more.click();
    expect(menu.show).toHaveBeenCalledOnce();
    row.more.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    menu.close();
    row.more.click();
    expect(menu.show).toHaveBeenCalledOnce();
    expect(menu.open).toBe(false);
  });
});
