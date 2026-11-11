// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLeave } from "../ui/leave.js";

// The way out of desk.universal's overlay, which covers the whole desk (07 #16): a Close button in
// sight that says Escape does the same, and a press on the margin beside a drawn view.
function mount(beside = true) {
  const root = document.createElement("main");
  root.id = "root";
  const view = document.createElement("desk-universal-view");
  root.append(view);
  document.body.append(root);
  const close = vi.fn();
  const button = createLeave(root, { close, beside: () => beside });
  /** A press as a pointer makes it: down, then the click, on `target`. */
  const press = (target: Element) => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  return { root, view, close, button, press };
}

describe("leaving the universal overlay", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("shows Close first in the page, saying Escape does the same, and Close closes", () => {
    const m = mount();
    expect(m.root.firstElementChild).toBe(m.button);
    expect(m.button.textContent).toBe("CloseEsc");
    expect(m.button.querySelector("kbd")?.textContent).toBe("Esc");
    expect(m.button.getAttribute("aria-keyshortcuts")).toBe("Escape");
    expect(m.button.className).toContain("desk-btn");
    m.button.click();
    expect(m.close).toHaveBeenCalledOnce();
  });

  it("a press on the margin beside the view closes it; a press on the view does not", () => {
    const m = mount();
    m.press(m.view);
    expect(m.close).not.toHaveBeenCalled();
    m.press(m.root);
    expect(m.close).toHaveBeenCalledOnce();
    // A selection dragged out of the view ends on the margin: not a press beside it.
    m.view.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    m.root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(m.close).toHaveBeenCalledOnce();
  });

  it("a press beside does nothing while the page says no (the builder, a preview waiting)", () => {
    const m = mount(false);
    m.press(m.root);
    expect(m.close).not.toHaveBeenCalled();
    m.button.click();
    expect(m.close).toHaveBeenCalledOnce();
  });
});
