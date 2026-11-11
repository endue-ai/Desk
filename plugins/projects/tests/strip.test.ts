// @vitest-environment jsdom
// The views' tab strip in a toolbar narrower than its tabs: it names the ends that hide tabs, keeps
// the chosen tab in sight, and turns a wheel over it into a sideways scroll. jsdom has no layout,
// so the strip's sizes and the tabs' boxes are given.
import { beforeEach, describe, expect, it } from "vitest";
import { createStrip } from "../ui/strip.js";

const TAB = 60;

/** A 150 px strip of six 60 px tabs, the `chosen` one selected. */
function strip(chosen = 0) {
  const el = document.createElement("div");
  for (let i = 0; i < 6; i++) {
    const tab = document.createElement("button");
    tab.setAttribute("aria-selected", i === chosen ? "true" : "false");
    tab.getBoundingClientRect = () => {
      const left = i * TAB - el.scrollLeft;
      return { left, right: left + TAB, top: 0, bottom: 24 } as DOMRect;
    };
    el.append(tab);
  }
  let left = 0;
  Object.defineProperties(el, {
    scrollWidth: { value: 6 * TAB },
    clientWidth: { value: 150 },
    scrollLeft: {
      get: () => left,
      set: (to: number) => {
        left = Math.max(0, Math.min(to, 6 * TAB - 150));
        el.dispatchEvent(new Event("scroll"));
      },
    },
  });
  el.getBoundingClientRect = () => ({ left: 0, right: 150, top: 0, bottom: 24 }) as DOMRect;
  document.body.append(el);
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the views' tab strip", () => {
  it("names the ends that hide tabs", () => {
    const el = strip();
    createStrip(el).show();
    expect(el.dataset.more).toBe("end");
    el.scrollLeft = 100;
    expect(el.dataset.more).toBe("both");
    el.scrollLeft = 1000;
    expect(el.dataset.more).toBe("start");
  });

  it("scrolls until the chosen tab is whole in sight, and back", () => {
    const el = strip(5);
    const { show } = createStrip(el);
    show();
    expect(el.scrollLeft).toBe(6 * TAB - 150);
    el.querySelectorAll("button").forEach((b, i) => {
      b.setAttribute("aria-selected", i === 1 ? "true" : "false");
    });
    show();
    expect(el.scrollLeft).toBe(TAB);
  });

  it("turns a wheel over it into a sideways scroll, and leaves a sideways one alone", () => {
    const el = strip();
    createStrip(el);
    const down = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
    el.dispatchEvent(down);
    expect(el.scrollLeft).toBe(40);
    expect(down.defaultPrevented).toBe(true);
    const sideways = new WheelEvent("wheel", { deltaX: 30, cancelable: true });
    el.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(false);
  });

  it("says nothing when every tab fits", () => {
    const el = document.createElement("div");
    Object.defineProperties(el, { scrollWidth: { value: 100 }, clientWidth: { value: 150 } });
    createStrip(el).show();
    expect(el.dataset.more).toBeUndefined();
    const wheel = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
    el.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});
