/**
 * The tooltip of a floating bar (the agent bar, the rail): the page's own, since it must show on
 * keyboard focus too and stand beside the control it names, where a `title` is drawn by the
 * compositor at the pointer, after a rest, on hover only (ADR 0160). A control labelled here
 * carries no `title`, so each is labelled once (ADR 0193). One line for the name, more for what
 * the control is doing; the lines are read when the tooltip shows and when the bar is drawn anew.
 */
import { h, listen } from "./dom";
import { elapsed } from "./Running";

/** A control's lines, read each time its tooltip shows. None shows no tooltip. */
type Lines = () => readonly string[];

const LINES = new WeakMap<HTMLElement, Lines>();

/** Give `control` the lines its bar's tooltip shows for it. */
export function withTip<T extends HTMLElement>(control: T, lines: Lines): T {
  LINES.set(control, lines);
  return control;
}

/**
 * What an agent works on, as its tooltip's second line: the goal and the time since it started
 * at `since`, the time alone without a goal. The time is as of `now`; it does not tick.
 */
export function workLine(goal: string | undefined, since: string, now: number): string {
  const started = Date.parse(since);
  const time = Number.isNaN(started) ? "" : elapsed(now - started);
  return [goal?.replace(/\s+/g, " ").trim(), time].filter(Boolean).join(" · ");
}

export interface BarTipOptions {
  id: string;
  /** The app's edge the bar is at: the tooltip stands past the bar's other side (kit.css). */
  edge: "left" | "right";
  /** The bar's controls a tooltip may name. */
  controls: string;
}

export interface BarTip {
  /** Show what it shows again: the bar has drawn its controls anew, or has scrolled. */
  refresh(): void;
  dispose(): void;
}

/** Mount `bar`'s tooltip in `root`, beside the bar; it follows the pointer and the focus on `bar`. */
export function mountBarTip(root: HTMLElement, bar: HTMLElement, options: BarTipOptions): BarTip {
  const el = h("div", {
    class: "tooltip",
    role: "tooltip",
    id: options.id,
    "data-edge": options.edge,
    hidden: true,
  });
  root.append(el);
  /** The control it names, by its `data-key`: a redraw replaces the element, not the key. */
  let key: string | null = null;

  const show = (control: HTMLElement | null) => {
    const lines = (control ? (LINES.get(control)?.() ?? []) : []).filter((line) => line !== "");
    key = control?.dataset.key ?? null;
    if (!control || lines.length === 0) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    el.replaceChildren(...lines.map((line) => h("span", { class: "tip-line" }, line)));
    el.hidden = false;
    // Level with the control as drawn: a bar is centred by a transform that offsetTop leaves out.
    const at = control.getBoundingClientRect();
    el.style.top = `${at.top + at.height / 2 - root.getBoundingClientRect().top}px`;
  };
  const named = () =>
    [...bar.querySelectorAll<HTMLElement>(options.controls)].find((c) => c.dataset.key === key);
  const refresh = () => {
    if (key !== null) show(named() ?? null);
  };
  const target = (event: Event) =>
    (event.target as Element | null)?.closest<HTMLElement>(options.controls) ?? null;
  const offs = [
    listen(bar, "pointerover", (event) => show(target(event))),
    listen(bar, "pointerleave", () => show(null)),
    listen(bar, "focusin", (event) => show(target(event))),
    listen(bar, "focusout", () => show(null)),
    listen(bar, "scroll", refresh, { passive: true }),
  ];
  return {
    refresh,
    dispose: () => {
      for (const off of offs) off();
      el.remove();
    },
  };
}
