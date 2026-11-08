import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { press, reset } from "./test-dom";

defineElements();

function button(label = "Save") {
  const element = document.createElement("desk-button");
  element.textContent = label;
  document.body.append(element);
  return element;
}

describe("desk-button", () => {
  beforeEach(reset);

  it("is a button in the tab order, named by its text", () => {
    const element = button();
    expect(element.getAttribute("role")).toBe("button");
    expect(element.tabIndex).toBe(0);
    expect(element.textContent).toBe("Save");
    expect(element.hasAttribute("aria-disabled")).toBe(false);
  });

  it("clicks on Enter and on Space, and on no other key", () => {
    const element = button();
    const onClick = vi.fn();
    element.addEventListener("click", onClick);
    element.focus();
    expect(document.activeElement).toBe(element);
    expect(press("Enter")).toBe(true);
    expect(press(" ")).toBe(true);
    press("a");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("leaves the tab order and swallows clicks while disabled", () => {
    const element = button();
    const onClick = vi.fn();
    element.addEventListener("click", onClick);
    element.disabled = true;
    expect(element.getAttribute("aria-disabled")).toBe("true");
    expect(element.tabIndex).toBe(-1);
    element.click();
    expect(onClick).not.toHaveBeenCalled();

    element.disabled = false;
    expect(element.hasAttribute("aria-disabled")).toBe(false);
    expect(element.tabIndex).toBe(0);
    element.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps a role the page gave it", () => {
    const element = document.createElement("desk-button");
    element.setAttribute("role", "tab");
    document.body.append(element);
    expect(element.getAttribute("role")).toBe("tab");
  });
});
