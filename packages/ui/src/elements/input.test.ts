import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { focused, query, reset } from "./test-dom";

defineElements();

function field(label: string | null = "Name") {
  const element = document.createElement("desk-input");
  if (label !== null) element.setAttribute("label", label);
  document.body.append(element);
  return { element, input: query(element.shadowRoot, "input") as HTMLInputElement };
}

describe("desk-input", () => {
  beforeEach(reset);

  it("wraps a native text input in a label that names it", () => {
    const { element, input } = field();
    const label = query(element.shadowRoot, "label");
    expect(input.type).toBe("text");
    expect(label.contains(input)).toBe(true);
    expect(label.textContent).toBe("Name");
    element.setAttribute("label", "Title");
    expect(label.textContent).toBe("Title");
  });

  it("passes aria-label on when there is no visible label", () => {
    const { element, input } = field(null);
    element.setAttribute("aria-label", "Search");
    expect(input.getAttribute("aria-label")).toBe("Search");
  });

  it("reflects value, placeholder, type and disabled", () => {
    const { element, input } = field();
    element.setAttribute("value", "draft");
    expect(input.value).toBe("draft");
    element.value = "final";
    expect(input.value).toBe("final");
    input.value = "typed";
    expect(element.value).toBe("typed");

    element.setAttribute("placeholder", "Untitled");
    expect(input.getAttribute("placeholder")).toBe("Untitled");
    element.setAttribute("type", "search");
    expect(input.type).toBe("search");
    element.setAttribute("type", "checkbox");
    expect(input.type).toBe("text");

    element.disabled = true;
    expect(input.disabled).toBe(true);
    element.disabled = false;
    expect(input.disabled).toBe(false);
  });

  it("gives focus to its input", () => {
    const { element, input } = field();
    element.focus();
    expect(focused()).toBe(input);
    expect(document.activeElement).toBe(element);
  });

  it("lets input through and re-dispatches change from the host", () => {
    const { element, input } = field();
    const onInput = vi.fn();
    const onChange = vi.fn();
    element.addEventListener("input", onInput);
    element.addEventListener("change", onChange);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput.mock.calls[0]?.[0].target).toBe(element);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].target).toBe(element);
  });
});
