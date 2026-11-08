import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { press, reset } from "./test-dom";

defineElements();

function dialog() {
  const opener = document.createElement("desk-button");
  opener.textContent = "Rename";
  const element = document.createElement("desk-dialog");
  element.setAttribute("label", "Rename the file");
  const name = document.createElement("desk-input");
  name.setAttribute("label", "Name");
  const ok = document.createElement("desk-button");
  ok.textContent = "OK";
  element.append(name, ok);
  document.body.append(opener, element);
  opener.focus();
  return { element, opener, name, ok };
}

describe("desk-dialog", () => {
  beforeEach(reset);

  it("is a labelled modal dialog, closed until shown", () => {
    const { element } = dialog();
    expect(element.getAttribute("role")).toBe("dialog");
    expect(element.getAttribute("aria-modal")).toBe("true");
    expect(element.getAttribute("aria-label")).toBe("Rename the file");
    expect(element.open).toBe(false);
  });

  it("moves focus inside when shown and keeps Tab inside", () => {
    const { element, name, ok } = dialog();
    element.show();
    expect(element.open).toBe(true);
    expect(document.activeElement).toBe(name);

    expect(press("Tab", { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(ok);
    expect(press("Tab")).toBe(true);
    expect(document.activeElement).toBe(name);
  });

  it("focuses the element marked autofocus first", () => {
    const { element, ok } = dialog();
    ok.setAttribute("autofocus", "");
    element.show();
    expect(document.activeElement).toBe(ok);
  });

  it("closes on Escape, says so and gives focus back", () => {
    const { element, opener } = dialog();
    const onClose = vi.fn();
    element.addEventListener("close", onClose);
    element.show();
    expect(press("Escape")).toBe(true);
    expect(element.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it("stays open when a cancel listener says so", () => {
    const { element } = dialog();
    element.addEventListener("cancel", (event) => event.preventDefault());
    element.show();
    press("Escape");
    expect(element.open).toBe(true);
  });

  it("holds focus itself when nothing inside takes it", () => {
    const element = document.createElement("desk-dialog");
    element.textContent = "Saved.";
    document.body.append(element);
    element.show();
    expect(document.activeElement).toBe(element);
    expect(press("Tab")).toBe(true);
    expect(document.activeElement).toBe(element);
  });
});
