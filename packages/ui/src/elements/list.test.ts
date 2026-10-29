import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { press, reset } from "./test-dom";

defineElements();

function list(...labels: string[]) {
  const element = document.createElement("desk-list");
  element.setAttribute("label", "Files");
  for (const label of labels) {
    const option = document.createElement("div");
    option.textContent = label;
    element.append(option);
  }
  document.body.append(element);
  return { element, options: [...element.children] as HTMLElement[] };
}

describe("desk-list", () => {
  beforeEach(reset);

  it("is a labelled listbox of options in the tab order", () => {
    const { element, options } = list("a.txt", "b.txt", "c.txt");
    expect(element.getAttribute("role")).toBe("listbox");
    expect(element.getAttribute("aria-label")).toBe("Files");
    expect(element.tabIndex).toBe(0);
    for (const option of options) {
      expect(option.getAttribute("role")).toBe("option");
      expect(option.getAttribute("aria-selected")).toBe("false");
    }
    expect(new Set(options.map((option) => option.id)).size).toBe(3);
    expect(element.selectedIndex).toBe(-1);
  });

  it("moves the active option with the arrows, Home and End", () => {
    const { element, options } = list("a.txt", "b.txt", "c.txt");
    const active = () => element.getAttribute("aria-activedescendant");
    element.focus();
    expect(press("ArrowDown")).toBe(true);
    expect(active()).toBe(options[0]?.id);
    expect(options[0]?.hasAttribute("data-active")).toBe(true);
    press("ArrowDown");
    expect(active()).toBe(options[1]?.id);
    press("End");
    expect(active()).toBe(options[2]?.id);
    press("ArrowDown");
    expect(active()).toBe(options[2]?.id);
    press("Home");
    expect(active()).toBe(options[0]?.id);
    press("ArrowUp");
    expect(active()).toBe(options[0]?.id);
    expect(options.filter((option) => option.hasAttribute("data-active"))).toEqual([options[0]]);
  });

  it("selects with Enter, Space and a click, and says so", () => {
    const { element, options } = list("a.txt", "b.txt", "c.txt");
    const onSelect = vi.fn();
    element.addEventListener("desk-select", onSelect);
    element.focus();
    press("ArrowDown");
    press("ArrowDown");
    expect(press("Enter")).toBe(true);
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual({ index: 1, item: options[1] });
    expect(element.selectedIndex).toBe(1);
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);

    press("Home");
    press(" ");
    expect(onSelect.mock.calls[1]?.[0].detail).toEqual({ index: 0, item: options[0] });

    options[2]?.click();
    expect(onSelect.mock.calls[2]?.[0].detail).toEqual({ index: 2, item: options[2] });
    expect(element.getAttribute("aria-activedescendant")).toBe(options[2]?.id);
  });

  it("does nothing on Enter before an option is active", () => {
    const { element } = list("a.txt");
    const onSelect = vi.fn();
    element.addEventListener("desk-select", onSelect);
    element.focus();
    expect(press("Enter")).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("takes options added later", () => {
    const { element } = list("a.txt");
    const added = document.createElement("div");
    added.textContent = "b.txt";
    element.append(added);
    expect(added.getAttribute("role")).toBe("option");
    expect(added.id).not.toBe("");
    element.focus();
    press("End");
    expect(element.getAttribute("aria-activedescendant")).toBe(added.id);
  });
});
