import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements, elements } from "./index";
import { parseRules } from "./test-css";
import { query, queryAll, reset } from "./test-dom";

defineElements();

/** A progress element with `attributes`, put on the page. */
function progress(attributes: Record<string, string> = {}) {
  const element = document.createElement("desk-progress");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  const root = element.shadowRoot;
  const [bar] = queryAll(root, (el) => el.getAttribute("role") === "progressbar");
  if (!bar) throw new Error("no progressbar");
  const fill = queryAll(root, (el) => el.getAttribute("part") === "fill")[0] as HTMLElement;
  const detail = queryAll(root, (el) => el.getAttribute("part") === "detail")[0] as HTMLElement;
  const label = queryAll(root, (el) => el.getAttribute("part") === "label")[0] as HTMLElement;
  return { element, bar, fill, detail, label, cancel: query(root, "button") };
}

describe("desk-progress", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is a determinate progressbar with its values and text", () => {
    const { element, bar, fill, detail, label } = progress({
      label: "Reading budget.xlsx",
      value: "12.4",
      max: "48",
      detail: "12.4 of 48.0 MB",
      delay: "0",
    });
    expect(bar.getAttribute("aria-label")).toBe("Reading budget.xlsx");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("48");
    expect(bar.getAttribute("aria-valuenow")).toBe("12.4");
    expect(bar.getAttribute("aria-valuetext")).toBe("25%, 12.4 of 48.0 MB");
    expect(label.textContent).toBe("Reading budget.xlsx");
    expect(detail.textContent).toBe("12.4 of 48.0 MB");
    expect(fill.style.transform).toBe("scaleX(0.2583)");
    expect(element.indeterminate).toBe(false);

    element.value = 60;
    expect(bar.getAttribute("aria-valuenow")).toBe("48");
    expect(bar.getAttribute("aria-valuetext")).toBe("100%, 12.4 of 48.0 MB");
    element.detail = "";
    element.max = 200;
    expect(bar.getAttribute("aria-valuetext")).toBe("30%");
    expect(detail.hidden).toBe(true);
  });

  it("measures against 1 without a max, as <progress> does", () => {
    const { bar } = progress({ value: "0.5", delay: "0" });
    expect(bar.getAttribute("aria-valuemax")).toBe("1");
    expect(bar.getAttribute("aria-valuetext")).toBe("50%");
  });

  it("is indeterminate without a value: no aria-valuenow, a moving stripe", () => {
    const { element, bar, fill } = progress({ label: "Opening", delay: "0" });
    expect(element.indeterminate).toBe(true);
    expect(element.value).toBeNull();
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(bar.hasAttribute("aria-valuetext")).toBe(false);
    expect(bar.hasAttribute("data-indeterminate")).toBe(true);
    expect(fill.hasAttribute("data-still")).toBe(false);

    element.detail = "Counting rows";
    expect(bar.getAttribute("aria-valuetext")).toBe("Counting rows");
    element.value = 3;
    expect(bar.hasAttribute("data-indeterminate")).toBe(false);
    element.value = null;
    expect(element.hasAttribute("value")).toBe(false);
    expect(bar.hasAttribute("data-indeterminate")).toBe(true);
    element.setAttribute("value", "not a number");
    expect(element.indeterminate).toBe(true);
  });

  it("stays hidden until its delay passes, 300 ms by default", () => {
    const quick = progress();
    expect(quick.element.shown).toBe(false);
    vi.advanceTimersByTime(299);
    expect(quick.element.hasAttribute("shown")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(quick.element.hasAttribute("shown")).toBe(true);

    const slow = progress({ delay: "1000" });
    vi.advanceTimersByTime(999);
    expect(slow.element.shown).toBe(false);
    vi.advanceTimersByTime(1);
    expect(slow.element.shown).toBe(true);

    // Hidden again, it waits its delay again once it comes back.
    slow.element.hidden = true;
    expect(slow.element.shown).toBe(false);
    slow.element.hidden = false;
    vi.advanceTimersByTime(999);
    expect(slow.element.shown).toBe(false);
    vi.advanceTimersByTime(1);
    expect(slow.element.shown).toBe(true);

    // Taken off the page before its delay, it never shows.
    const gone = progress({ delay: "500" });
    gone.element.remove();
    vi.advanceTimersByTime(1000);
    expect(gone.element.shown).toBe(false);
  });

  it("shows at once with delay 0, and its CSS keeps it invisible until then", () => {
    expect(progress({ delay: "0" }).element.shown).toBe(true);
    const rules = parseRules(elements["desk-progress"].styles);
    const waiting = rules.find((rule) => rule.selector === ":host(:not([shown]))");
    expect(waiting?.declarations.visibility).toBe("hidden");
  });

  it("offers Cancel only when cancelable, and Cancel fires desk-cancel", () => {
    const { element, cancel } = progress({ delay: "0" });
    expect(cancel.hidden).toBe(true);
    element.setAttribute("cancelable", "");
    expect(cancel.hidden).toBe(false);
    expect(cancel.getAttribute("type")).toBe("button");
    expect(cancel.textContent).toBe("Cancel");
    element.setAttribute("cancel-label", "취소");
    expect(cancel.textContent).toBe("취소");

    const onCancel = vi.fn();
    document.body.addEventListener("desk-cancel", onCancel);
    cancel.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("desk-cancel", onCancel);
    element.cancelable = false;
    expect(cancel.hidden).toBe(true);
  });

  it("stops the stripe under reduced motion, the OS's or the desk's", () => {
    const css = elements["desk-progress"].styles;
    // The OS setting, in CSS.
    const media = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1];
    expect(media).toMatch(/\.fill \{[^}]*animation: none;/);
    // The desk's own setting (data-motion on the frame's root) and the OS's, read when it connects.
    const still = parseRules(css).find((rule) => rule.selector.includes(".fill[data-still]"));
    expect(still?.declarations.animation).toBe("none");

    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener() {},
      removeEventListener() {},
    }));
    expect(progress({ delay: "0" }).fill.hasAttribute("data-still")).toBe(true);
    vi.unstubAllGlobals();

    const root = document.createElement("html");
    root.setAttribute("data-motion", "reduce");
    Object.defineProperty(document, "documentElement", { value: root, configurable: true });
    try {
      expect(progress({ delay: "0" }).fill.hasAttribute("data-still")).toBe(true);
      root.setAttribute("data-motion", "full");
      expect(progress({ delay: "0" }).fill.hasAttribute("data-still")).toBe(false);
    } finally {
      Reflect.deleteProperty(document, "documentElement");
    }
  });
});
