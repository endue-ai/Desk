import { beforeEach, describe, expect, it } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { queryAll, reset } from "./test-dom";

defineElements();

describe("desk-stat", () => {
  beforeEach(reset);

  it("shows one number with its label and unit, named as one for screen readers", () => {
    const element = document.createElement("desk-stat");
    element.setAttribute("label", "Open tasks");
    element.setAttribute("value", "7");
    document.body.append(element);
    const root = element.shadowRoot as unknown as Element;
    const part = (name: string) =>
      queryAll(root, (el) => el.getAttribute("class") === name)[0]?.textContent;
    expect(element.getAttribute("role")).toBe("group");
    expect(element.getAttribute("aria-label")).toBe("Open tasks: 7");
    expect(part("value")).toBe("7");
    expect(part("label")).toBe("Open tasks");
    // Read once, as the name: the parts are hidden from screen readers.
    const parts = queryAll(root, (el) =>
      ["value", "unit", "label"].includes(el.getAttribute("class") ?? ""),
    );
    expect(parts.length).toBeGreaterThan(0);
    for (const el of parts) expect(el.getAttribute("aria-hidden")).toBe("true");

    element.setAttribute("value", "8");
    element.setAttribute("unit", "min");
    expect(part("value")).toBe("8");
    expect(part("unit")).toBe("min");
    expect(element.getAttribute("aria-label")).toBe("Open tasks: 8 min");
  });
});
