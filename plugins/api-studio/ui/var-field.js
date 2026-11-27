// A one-line field that shows {{variables}} in colour (set, made fresh, or missing) and, under the
// pointer, what a variable holds and where it comes from. Typing `{{` offers the names in reach.
// The input's own text is clear and sits exactly over the coloured copy, so caret and selection
// stay the browser's.

import { h } from "./dom.js";
import { paint, withVars } from "./highlight.js";
import { DYNAMIC, lookup } from "./vars.js";

/**
 * @typedef {{ value: string, placeholder?: string, label: string, secret?: boolean,
 *   scopes: () => import("./vars.js").Scope[], onChange?(value: string): void,
 *   onEnter?(event: KeyboardEvent): void, className?: string }} FieldSpec
 */

/** One tooltip for every field on the page. */
let tip = /** @type {HTMLElement | null} */ (null);
function tooltip() {
  if (!tip) {
    tip = h("div.var-tip", { role: "tooltip" });
    document.body.append(tip);
  }
  return tip;
}

/** Show what a variable holds near a rectangle. @param {DOMRect} rect @param {string} name @param {import("./vars.js").Scope[]} scopes */
export function showVarTip(rect, name, scopes) {
  const el = tooltip();
  const found = lookup(scopes, name);
  const dyn = DYNAMIC[name];
  const value = dyn
    ? dyn.desc
    : found
      ? found.secret
        ? "••••••••"
        : found.value || "(empty)"
      : "Not defined in any scope";
  el.replaceChildren(
    h(
      "div.var-tip-head",
      null,
      h("span.var-tip-name", null, name),
      h(
        `span.var-tip-scope.s-${found ? found.scope : "missing"}`,
        null,
        found ? found.label : "Missing",
      ),
    ),
    h("div.var-tip-value", null, value),
  );
  el.classList.add("is-shown");
  const width = 300;
  el.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left))}px`;
  el.style.top = `${rect.bottom + 6}px`;
}

export function hideVarTip() {
  tip?.classList.remove("is-shown");
}

/** @param {FieldSpec} spec */
export function varField(spec) {
  const hl = h("div.vf-hl", { "aria-hidden": "true" });
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-field.vf-input", {
      type: "text",
      spellcheck: "false",
      autocomplete: "off",
      "aria-label": spec.label,
      placeholder: spec.placeholder ?? "",
    })
  );
  input.value = spec.value;
  const menu = h("div.vf-menu", { role: "listbox", hidden: true });
  const root = h(`div.vf${spec.className ? `.${spec.className}` : ""}`, null, hl, input, menu);
  let masked = spec.secret === true;

  const draw = () => {
    const text = input.value;
    if (masked && text && !text.includes("{{")) {
      hl.textContent = "•".repeat(Math.min(text.length, 40));
      root.classList.add("is-masked");
    } else {
      root.classList.remove("is-masked");
      paint(hl, withVars([{ c: "", s: text }], spec.scopes()));
    }
    hl.scrollLeft = input.scrollLeft;
  };

  /** @type {string[]} */
  let options = [];
  let chosen = 0;
  const closeMenu = () => {
    menu.hidden = true;
    options = [];
  };
  const openMenu = () => {
    const at = input.selectionStart ?? 0;
    const before = input.value.slice(0, at);
    const open = before.lastIndexOf("{{");
    if (open < 0 || before.slice(open).includes("}}")) return closeMenu();
    const typed = before
      .slice(open + 2)
      .trim()
      .toLowerCase();
    const names = new Set();
    for (const s of spec.scopes()) for (const name of s.values.keys()) names.add(name);
    options = [...names, ...Object.keys(DYNAMIC)]
      .map(String)
      .filter((n) => n.toLowerCase().includes(typed))
      .slice(0, 12);
    if (!options.length) return closeMenu();
    chosen = Math.min(chosen, options.length - 1);
    const scopes = spec.scopes();
    menu.replaceChildren(
      ...options.map((name, i) => {
        const found = lookup(scopes, name);
        return h(
          `div.vf-option${i === chosen ? ".is-active" : ""}`,
          {
            role: "option",
            onMousedown: (/** @type {MouseEvent} */ e) => {
              e.preventDefault();
              pick(name);
            },
          },
          h("span.vf-option-name", null, name),
          h("span.vf-option-scope", null, found?.label ?? ""),
        );
      }),
    );
    menu.hidden = false;
  };
  const pick = (/** @type {string} */ name) => {
    const at = input.selectionStart ?? 0;
    const open = input.value.slice(0, at).lastIndexOf("{{");
    const rest = input.value.slice(at);
    const closeAt = rest.startsWith("}}") ? 2 : 0;
    input.setRangeText(`{{${name}}}`, open, at + closeAt, "end");
    closeMenu();
    changed();
  };

  const changed = () => {
    draw();
    spec.onChange?.(input.value);
  };
  input.addEventListener("input", () => {
    changed();
    openMenu();
  });
  input.addEventListener("scroll", () => {
    hl.scrollLeft = input.scrollLeft;
  });
  input.addEventListener("keyup", () => {
    hl.scrollLeft = input.scrollLeft;
  });
  input.addEventListener("blur", () => {
    closeMenu();
    hideVarTip();
  });
  input.addEventListener("focus", () => {
    if (masked) {
      masked = false;
      draw();
    }
  });
  input.addEventListener("blur", () => {
    if (spec.secret) {
      masked = true;
      draw();
    }
  });
  input.addEventListener("keydown", (event) => {
    if (!menu.hidden && options.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        chosen = (chosen + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
        openMenu();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(options[chosen] ?? "");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
    }
    if (event.key === "Enter") spec.onEnter?.(event);
  });
  input.addEventListener("mousemove", (event) => {
    const spans = /** @type {HTMLElement[]} */ ([...hl.querySelectorAll("[data-var]")]);
    const over = spans.find((span) => {
      const r = span.getBoundingClientRect();
      return (
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top - 4 &&
        event.clientY <= r.bottom + 4
      );
    });
    if (over) showVarTip(over.getBoundingClientRect(), over.dataset.var ?? "", spec.scopes());
    else hideVarTip();
  });
  input.addEventListener("mouseleave", hideVarTip);
  draw();

  return {
    el: root,
    input,
    get value() {
      return input.value;
    },
    /** @param {string} text */
    set(text) {
      if (input.value !== text) input.value = text;
      draw();
    },
    redraw: draw,
    focus: () => input.focus(),
  };
}
