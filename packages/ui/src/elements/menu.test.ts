import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { place, pointer, press, reset } from "./test-dom";

defineElements();

function menu() {
  const anchor = document.createElement("desk-button");
  anchor.textContent = "More";
  place(anchor, { left: 24, bottom: 40 });
  const element = document.createElement("desk-menu");
  element.setAttribute("label", "File actions");
  const [rename, separator, remove] = ["div", "div", "div"].map((tag) =>
    document.createElement(tag),
  ) as [HTMLElement, HTMLElement, HTMLElement];
  rename.textContent = "Rename";
  separator.setAttribute("role", "separator");
  remove.textContent = "Delete";
  element.append(rename, separator, remove);
  document.body.append(anchor, element);
  anchor.focus();
  return { element, anchor, rename, separator, remove };
}

describe("desk-menu", () => {
  beforeEach(reset);

  it("is a labelled menu of menu items, closed until shown", () => {
    const { element, rename, separator, remove } = menu();
    expect(element.getAttribute("role")).toBe("menu");
    expect(element.getAttribute("aria-label")).toBe("File actions");
    expect(element.open).toBe(false);
    for (const item of [rename, remove]) {
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.tabIndex).toBe(-1);
    }
    expect(separator.getAttribute("role")).toBe("separator");
    expect(separator.hasAttribute("tabindex")).toBe(false);
  });

  it("opens below its anchor and focuses the first item", () => {
    const { element, anchor, rename } = menu();
    element.show(anchor);
    expect(element.open).toBe(true);
    expect(document.activeElement).toBe(rename);
    expect(element.style.top).toBe("44px");
    expect(element.style.left).toBe("24px");
    expect(anchor.getAttribute("aria-haspopup")).toBe("menu");
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    expect(anchor.getAttribute("aria-controls")).toBe(element.id);
  });

  it("moves focus with the arrows, wrapping, and with Home and End", () => {
    const { element, anchor, rename, remove } = menu();
    element.show(anchor);
    expect(press("ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(remove);
    press("ArrowDown");
    expect(document.activeElement).toBe(rename);
    press("ArrowUp");
    expect(document.activeElement).toBe(remove);
    press("Home");
    expect(document.activeElement).toBe(rename);
    press("End");
    expect(document.activeElement).toBe(remove);
  });

  it("activates an item with Enter, closes and gives focus back to the anchor", () => {
    const { element, anchor, remove } = menu();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    element.addEventListener("desk-select", onSelect);
    element.addEventListener("close", onClose);
    element.show(anchor);
    press("End");
    expect(press("Enter")).toBe(true);
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual({ index: 1, item: remove });
    expect(element.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
  });

  it("activates an item on click", () => {
    const { element, anchor, rename } = menu();
    const onSelect = vi.fn();
    element.addEventListener("desk-select", onSelect);
    element.show(anchor);
    rename.click();
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual({ index: 0, item: rename });
    expect(element.open).toBe(false);
  });

  it("closes on Escape and gives focus back to the anchor", () => {
    const { element, anchor } = menu();
    element.show(anchor);
    expect(press("Escape")).toBe(true);
    expect(element.open).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it("closes on a press outside and leaves focus alone", () => {
    const { element, anchor, rename } = menu();
    const elsewhere = document.createElement("desk-button");
    document.body.append(elsewhere);
    element.show(anchor);
    pointer(rename, "pointerdown");
    expect(element.open).toBe(true);
    pointer(anchor, "pointerdown");
    expect(element.open).toBe(true);
    pointer(elsewhere, "pointerdown");
    expect(element.open).toBe(false);
    expect(document.activeElement).toBe(rename);
  });

  it("toggles", () => {
    const { element, anchor } = menu();
    element.toggle(anchor);
    expect(element.open).toBe(true);
    element.toggle(anchor);
    expect(element.open).toBe(false);
  });
});
