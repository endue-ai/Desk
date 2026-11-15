// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mountBarTip, withTip } from "./bar-tip";
import { h } from "./dom";

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  document.body.replaceChildren();
});

/** A bar of two controls with a rule between them, and its tooltip. */
function bar() {
  const root = h("div");
  const el = h("aside", { class: "float-bar" });
  const one = withTip(h("button", { type: "button", "data-key": "one" }), () => [
    "Mira · working",
    "Sort the inbox · 4:12",
  ]);
  const rule = h("div", { class: "bar-divider", role: "separator" });
  const two = withTip(h("button", { type: "button", "data-key": "two" }), () => ["Theo"]);
  el.append(one, rule, two);
  root.append(el);
  document.body.append(root);
  const tip = mountBarTip(root, el, { id: "test-tip", edge: "left", controls: "button" });
  offs.push(tip.dispose);
  const shown = root.querySelector<HTMLElement>('[role="tooltip"]');
  if (!shown) throw new Error("no tooltip");
  const lines = () => [...shown.children].map((line) => line.textContent);
  return { el, one, rule, two, tip, shown, lines };
}

const over = (el: Element) => el.dispatchEvent(new Event("pointerover", { bubbles: true }));
const focus = (el: Element) => el.dispatchEvent(new Event("focusin", { bubbles: true }));
const blur = (el: Element) => el.dispatchEvent(new Event("focusout", { bubbles: true }));

describe("a floating bar's tooltip", () => {
  it("a bar's tooltip shows a control's lines on hover and on focus, and goes when either leaves", () => {
    const { el, one, two, shown, lines } = bar();
    expect(shown.hidden).toBe(true);

    over(one);
    expect(shown.hidden).toBe(false);
    expect(lines()).toEqual(["Mira · working", "Sort the inbox · 4:12"]);
    el.dispatchEvent(new Event("pointerleave"));
    expect(shown.hidden).toBe(true);

    focus(two);
    expect(shown.hidden).toBe(false);
    expect(lines()).toEqual(["Theo"]);
    blur(two);
    expect(shown.hidden).toBe(true);

    // It names a control and is none itself: no focus stops on it, and the pointer goes through.
    expect(shown.id).toBe("test-tip");
    expect(shown.dataset.edge).toBe("left");
    expect(shown.tabIndex).toBe(-1);
    over(one);
    expect(shown.querySelector("button, a, input, [tabindex]")).toBeNull();
    expect(shown.classList.contains("tooltip")).toBe(true);
    const kit = readFileSync(join(import.meta.dirname, "kit.css"), "utf8");
    expect(/\.tooltip \{[^}]*pointer-events: none;/.test(kit)).toBe(true);
  });

  it("goes over a part of the bar that is no control, and for a control with no lines", () => {
    const { el, one, rule, shown } = bar();
    over(one);
    over(rule);
    expect(shown.hidden).toBe(true);
    const mute = withTip(h("button", { type: "button", "data-key": "mute" }), () => []);
    const bare = h("button", { type: "button", "data-key": "bare" });
    el.append(mute, bare);
    over(mute);
    expect(shown.hidden).toBe(true);
    over(bare);
    expect(shown.hidden).toBe(true);
  });

  it("follows its control through a redraw of the bar, with the lines it has then", () => {
    const { el, one, tip, shown, lines } = bar();
    over(one);
    const again = withTip(h("button", { type: "button", "data-key": "one" }), () => [
      "Mira · working",
      "Sort the inbox · 4:13",
    ]);
    one.replaceWith(again);
    tip.refresh();
    expect(shown.hidden).toBe(false);
    expect(lines()).toEqual(["Mira · working", "Sort the inbox · 4:13"]);
    // The control went with the redraw: so does its tooltip.
    again.remove();
    tip.refresh();
    expect(shown.hidden).toBe(true);
    // Nothing shown, nothing to follow.
    el.append(again);
    tip.refresh();
    expect(shown.hidden).toBe(true);
  });
});
