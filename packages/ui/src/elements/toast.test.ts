import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { pointer, press, query, reset } from "./test-dom";

defineElements();

function toast() {
  const element = document.createElement("desk-toast");
  const elsewhere = document.createElement("desk-button");
  document.body.append(elsewhere, element);
  const onClose = vi.fn();
  element.addEventListener("close", onClose);
  return { element, elsewhere, onClose, dismiss: query(element.shadowRoot, "button") };
}

describe("desk-toast", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("is a polite status, or an alert for errors", () => {
    const { element } = toast();
    expect(element.getAttribute("role")).toBe("status");
    element.setAttribute("tone", "error");
    expect(element.getAttribute("role")).toBe("alert");
    element.removeAttribute("tone");
    expect(element.getAttribute("role")).toBe("status");
  });

  it("shows a message and closes after its duration", () => {
    const { element, onClose } = toast();
    expect(element.open).toBe(false);
    element.show("Saved", { duration: 1000 });
    expect(element.open).toBe(true);
    expect(element.textContent).toBe("Saved");
    vi.advanceTimersByTime(999);
    expect(element.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(element.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("waits while focus is inside", () => {
    const { element, elsewhere, dismiss } = toast();
    element.show("Saved", { duration: 1000 });
    dismiss.focus();
    vi.advanceTimersByTime(5000);
    expect(element.open).toBe(true);
    elsewhere.focus();
    vi.advanceTimersByTime(1000);
    expect(element.open).toBe(false);
  });

  it("waits while the pointer is over it", () => {
    const { element } = toast();
    element.show("Saved", { duration: 1000 });
    pointer(element, "pointerenter");
    vi.advanceTimersByTime(5000);
    expect(element.open).toBe(true);
    pointer(element, "pointerleave");
    vi.advanceTimersByTime(1000);
    expect(element.open).toBe(false);
  });

  it("stays until closed when the duration is 0", () => {
    const { element } = toast();
    element.show("Offline", { duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(element.open).toBe(true);
  });

  it("closes on Escape from inside and from its labelled dismiss button", () => {
    const { element, dismiss, onClose } = toast();
    expect(dismiss.getAttribute("aria-label")).toBe("Dismiss");
    element.setAttribute("dismiss-label", "닫기");
    expect(dismiss.getAttribute("aria-label")).toBe("닫기");

    element.show("Offline", { duration: 0 });
    dismiss.focus();
    expect(press("Escape")).toBe(true);
    expect(element.open).toBe(false);

    element.show("Offline", { duration: 0 });
    dismiss.click();
    expect(element.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
