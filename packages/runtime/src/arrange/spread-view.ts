/**
 * The spread on screen (ADR 0116). A scrim blurs the desk and its bars; the windows layer rises above
 * it with a perspective, and each window is drawn at its pose: a transform and an opacity the shell
 * never writes, and a stacking order the stylesheet (`arrange.css`) puts above the shell's own.
 * Inside the windows nothing takes the pointer: a click picks the window, the pointer over one
 * selects it, a drag or the wheel on the scrim pans and a pinch or Control + wheel zooms. The
 * filter field keeps the keyboard; a list only assistive technology sees names every window.
 */

import type { Lang } from "../shell/copy";
import { h, listen } from "../shell/dom";
import { arrangeText } from "./copy";
import { arrangeIcon } from "./icons";
import type { Spread, SpreadView } from "./spread";
import { type Pose, type SpreadModel, transformOf } from "./spread-model";

export interface SpreadDom {
  /** Where the scrim and the overlay go (the mode layer). */
  root: HTMLElement;
  /** The shell, which the spreading state is set on. */
  shell: HTMLElement;
  /** The windows' layer. */
  layer: HTMLElement;
  element(id: string): HTMLElement | undefined;
  lang(): Lang;
  spread(): Spread | undefined;
}

const DRAG = 4;
const CARD = "is-spread-card";
const PROPS = ["transform", "opacity", "--spread-z"];

export function spreadView(dom: SpreadDom): SpreadView & { dispose(): void } {
  const say = (key: Parameters<typeof arrangeText>[1], vars?: Record<string, string | number>) =>
    arrangeText(dom.lang(), key, vars);
  let parts: ReturnType<typeof build> | undefined;
  let marked = new Set<string>();
  let before: Element | null = null;
  let offs: Array<() => void> = [];

  const build = () => {
    const scrim = h("div", {
      class: "arrange-scrim",
      "data-arrange": "scrim",
      "aria-hidden": "true",
    });
    const input = h("input", {
      class: "input arrange-filter",
      type: "text",
      role: "combobox",
      "aria-expanded": "true",
      "aria-autocomplete": "list",
      "aria-controls": "arrange-spread-list",
      autocomplete: "off",
      spellcheck: "false",
    });
    const count = h("p", { class: "arrange-count", "aria-live": "polite" });
    const hint = h("p", { class: "arrange-hint" });
    const list = h("ul", { class: "sr-only", id: "arrange-spread-list", role: "listbox" });
    const empty = h("p", { class: "arrange-empty", hidden: true });
    const bar = h(
      "div",
      { class: "arrange-spread-bar" },
      input,
      h("div", { class: "arrange-meta" }, count, hint),
    );
    const dialog = h(
      "div",
      { class: "arrange-spread", role: "dialog", "aria-modal": "true", "data-arrange": "spread" },
      bar,
      list,
      empty,
    );
    return { scrim, dialog, input, count, hint, list, empty };
  };

  /** Pointer and keys while the spread is open. */
  const wire = (p: NonNullable<typeof parts>) => {
    const spread = () => dom.spread();
    const card = (e: Event) =>
      (e.target as Element | null)?.closest?.<HTMLElement>(`.${CARD}[data-surface]`) ?? null;
    const stop = (e: Event) => {
      if (!card(e)) return;
      e.stopPropagation();
      e.preventDefault();
    };
    let drag: { x: number; y: number; moved: number } | undefined;
    const point = (e: { clientX: number; clientY: number }) => {
      const box = dom.shell.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    let pinch = 1;
    return [
      // Ahead of the windows' own handlers: in the spread a window is a card, not a window.
      listen(dom.layer, "pointerdown", stop, { capture: true }),
      listen(dom.layer, "mousedown", stop, { capture: true }),
      listen(dom.layer, "dblclick", stop, { capture: true }),
      listen(
        dom.layer,
        "click",
        (e) => {
          const el = card(e);
          if (!el) return;
          e.stopPropagation();
          e.preventDefault();
          void spread()?.choose(el.dataset.surface ?? "");
        },
        { capture: true },
      ),
      listen(dom.layer, "pointerover", (e) => {
        const id = card(e)?.dataset.surface;
        if (id) spread()?.hover(id);
      }),
      listen(p.scrim, "mousedown", (e) => e.preventDefault()),
      listen(p.scrim, "pointerdown", (e) => {
        drag = { x: e.clientX, y: e.clientY, moved: 0 };
        p.scrim.setPointerCapture?.(e.pointerId);
      }),
      listen(p.scrim, "pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) };
        spread()?.pan(dx, dy);
      }),
      listen(p.scrim, "pointerup", () => {
        // A click on the empty desk closes the spread; a drag only panned it.
        if (drag && drag.moved < DRAG) void spread()?.cancel();
        drag = undefined;
      }),
      listen(p.scrim, "pointercancel", () => {
        drag = undefined;
      }),
      listen(
        dom.shell,
        "wheel",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          const at = point(e);
          if (e.ctrlKey) spread()?.zoom(Math.exp(-e.deltaY / 200), at.x, at.y);
          else spread()?.pan(-e.deltaX, -e.deltaY);
        },
        { capture: true, passive: false },
      ),
      // Safari and WebKit report a trackpad pinch as gesture events with a scale.
      listen(dom.shell, "gesturestart", (e) => {
        e.preventDefault();
        pinch = 1;
      }),
      listen(dom.shell, "gesturechange", (e) => {
        e.preventDefault();
        const g = e as unknown as { scale: number; clientX: number; clientY: number };
        const at = point(g);
        spread()?.zoom(g.scale / pinch, at.x, at.y);
        pinch = g.scale;
      }),
      listen(p.dialog, "keydown", (e) => {
        if (spread()?.key(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }),
      listen(p.input, "input", () => spread()?.filter(p.input.value)),
    ];
  };

  const unmark = (id: string) => {
    const el = dom.element(id);
    if (!el) return;
    el.classList.remove(CARD, "is-spread-selected", "is-spread-out", "is-spread-asleep");
    for (const prop of PROPS) el.style.removeProperty(prop);
    el.querySelector(":scope > .arrange-sleep")?.remove();
  };

  return {
    open(model: SpreadModel) {
      if (!parts) {
        parts = build();
        before = document.activeElement;
        dom.root.append(parts.scrim, parts.dialog);
        dom.shell.classList.add("is-spreading");
        offs = wire(parts);
        parts.input.focus({ preventScroll: true });
      }
      const ids = new Set(model.windows().map((w) => w.id));
      for (const id of marked) if (!ids.has(id)) unmark(id);
      marked = ids;
      for (const w of model.windows()) {
        const el = dom.element(w.id);
        if (!el) continue;
        el.classList.add(CARD);
        el.classList.toggle("is-spread-asleep", w.asleep);
        const sleep = el.querySelector(":scope > .arrange-sleep");
        if (w.asleep && !sleep) {
          el.append(
            h(
              "div",
              { class: "arrange-sleep", "aria-hidden": "true" },
              arrangeIcon("asleep", 24),
              h("span", { class: "arrange-sleep-title" }, say("asleep")),
              h("span", { class: "arrange-sleep-line" }, say("asleepLine")),
            ),
          );
        } else if (!w.asleep) sleep?.remove();
      }
    },

    chrome(model: SpreadModel) {
      if (!parts) return;
      const shown = model.shown();
      const all = model.windows();
      parts.dialog.setAttribute("aria-label", say("spreadLabel"));
      parts.input.placeholder = say("filter");
      parts.input.setAttribute("aria-label", say("filter"));
      if (parts.input.value !== model.filter) parts.input.value = model.filter;
      parts.hint.textContent = say("hint");
      parts.count.textContent =
        shown.length === all.length
          ? say("count", { n: all.length })
          : say("countOf", { m: shown.length, n: all.length });
      parts.empty.hidden = shown.length > 0;
      parts.empty.textContent = shown.length > 0 ? "" : say("noMatch", { q: model.filter.trim() });
      parts.list.setAttribute("aria-label", say("spreadLabel"));
      parts.list.replaceChildren(
        ...shown.map((w) =>
          h(
            "li",
            {
              role: "option",
              id: `arrange-option-${w.id}`,
              "aria-selected": String(w.id === model.selected),
            },
            say(w.asleep ? "optionAsleep" : "option", { title: w.title }),
          ),
        ),
      );
      if (model.selected) {
        parts.input.setAttribute("aria-activedescendant", `arrange-option-${model.selected}`);
      } else parts.input.removeAttribute("aria-activedescendant");
    },

    draw(model: SpreadModel, poses: Map<string, Pose>) {
      const shown = new Set(model.shown().map((w) => w.id));
      for (const [id, pose] of poses) {
        const el = dom.element(id);
        if (!el) continue;
        // Transform and opacity inline, which nothing inherits, so a frame restyles the window
        // alone and not everything inside it; the stacking through the stylesheet, which outranks
        // the z-index the shell writes inline.
        el.style.transform = transformOf(pose);
        el.style.opacity = String(Math.round(pose.opacity * 1000) / 1000);
        const z = String(model.orderOf(id));
        if (el.style.getPropertyValue("--spread-z") !== z) el.style.setProperty("--spread-z", z);
        el.classList.toggle("is-spread-selected", id === model.selected);
        el.classList.toggle("is-spread-out", !shown.has(id));
      }
    },

    close() {
      for (const off of offs.splice(0)) off();
      for (const id of marked) unmark(id);
      marked = new Set();
      dom.shell.classList.remove("is-spreading");
      const focusWasHere = parts?.dialog.contains(document.activeElement) ?? false;
      parts?.scrim.remove();
      parts?.dialog.remove();
      parts = undefined;
      // Back where the keyboard was, unless choosing a window gives it the focus next.
      if (focusWasHere && before instanceof HTMLElement && before.isConnected)
        before.focus({ preventScroll: true });
      before = null;
    },

    dispose() {
      if (parts) this.close();
    },
  };
}
