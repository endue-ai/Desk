// The inspector's controls: a slider with its value and a way back to the server's default, a
// number field that may stay empty, a switch, segmented choices and a list of short strings as chips.
import { fill, h, icon, iconButton } from "./dom.js";

/**
 * A setting on a slider; empty means the server's default, shown as such.
 * @param {{ label: string, hint?: string, min: number, max: number, step: number, value?: number, fallback?: number, digits?: number, onChange: (v: number | undefined) => void }} o
 */
export function slider(o) {
  const shown = o.value ?? o.fallback ?? o.min;
  const out = h("span.lm-ctl-value", {
    dataset: { unset: o.value === undefined ? "1" : undefined },
  });
  const input = /** @type {HTMLInputElement} */ (
    h("input.lm-range", {
      type: "range",
      min: o.min,
      max: o.max,
      step: o.step,
      value: shown,
      "aria-label": o.label,
    })
  );
  const paint = (/** @type {number | undefined} */ v) => {
    const at = ((v ?? o.fallback ?? o.min) - o.min) / (o.max - o.min);
    input.style.setProperty("--lm-fill", `${Math.max(0, Math.min(1, at)) * 100}%`);
    input.dataset.unset = v === undefined ? "1" : "";
    out.dataset.unset = v === undefined ? "1" : "";
    fill(out, v === undefined ? "Default" : v.toFixed(o.digits ?? 2));
  };
  paint(o.value);
  input.addEventListener("input", () => paint(Number(input.value)));
  input.addEventListener("change", () => o.onChange(Number(input.value)));
  const reset = iconButton(
    "x",
    `Back to the default ${o.label.toLowerCase()}`,
    () => {
      input.value = String(o.fallback ?? o.min);
      paint(undefined);
      o.onChange(undefined);
    },
    { class: "lm-ctl-reset", hidden: o.value === undefined },
  );
  input.addEventListener("change", () => {
    reset.hidden = false;
  });
  return h(
    "div.lm-ctl",
    null,
    h("div.lm-ctl-row", null, h("label.lm-ctl-label", { title: o.hint }, o.label), reset, out),
    input,
    o.hint ? h("div.lm-ctl-hint", null, o.hint) : null,
  );
}

/**
 * A whole number that may stay empty (the default).
 * @param {{ label: string, hint?: string, value?: number, placeholder?: string, min?: number, max?: number, extra?: HTMLElement, onChange: (v: number | undefined) => void }} o
 */
export function numberField(o) {
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-field.lm-num", {
      type: "number",
      inputmode: "numeric",
      min: o.min,
      max: o.max,
      value: o.value ?? "",
      placeholder: o.placeholder ?? "Default",
      "aria-label": o.label,
    })
  );
  input.addEventListener("change", () => {
    const raw = input.value.trim();
    const n = raw === "" ? undefined : Math.round(Number(raw));
    o.onChange(n === undefined || Number.isNaN(n) ? undefined : n);
  });
  return h(
    "div.lm-ctl",
    null,
    h(
      "div.lm-ctl-row",
      null,
      h("label.lm-ctl-label", { title: o.hint }, o.label),
      h("div.lm-ctl-num", null, input, o.extra ?? null),
    ),
    o.hint ? h("div.lm-ctl-hint", null, o.hint) : null,
  );
}

/** An on/off setting. @param {{ label: string, hint?: string, checked: boolean, disabled?: boolean, onChange: (v: boolean) => void }} o */
export function toggle(o) {
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-check.lm-switch", {
      type: "checkbox",
      role: "switch",
      checked: o.checked,
      disabled: o.disabled,
      "aria-label": o.label,
    })
  );
  input.addEventListener("change", () => o.onChange(input.checked));
  return h(
    "label.lm-ctl.lm-ctl-toggle",
    { dataset: { disabled: o.disabled ? "1" : undefined } },
    h(
      "span.lm-ctl-text",
      null,
      h("span.lm-ctl-label", null, o.label),
      o.hint ? h("span.lm-ctl-hint", null, o.hint) : null,
    ),
    input,
  );
}

/**
 * One choice among a few, as a segmented control.
 * @template {string} T
 * @param {{ label?: string, value: T, options: { value: T, label: string }[], onChange: (v: T) => void }} o
 */
export function segmented(o) {
  return h(
    "div.desk-tabs.lm-seg",
    { role: "radiogroup", "aria-label": o.label },
    o.options.map((opt) =>
      h(
        "button.desk-tab",
        {
          type: "button",
          role: "radio",
          "aria-checked": opt.value === o.value ? "true" : "false",
          "aria-selected": opt.value === o.value ? "true" : "false",
          onClick: () => o.onChange(opt.value),
        },
        opt.label,
      ),
    ),
  );
}

/** Short strings as chips: Enter adds one, × removes it. @param {{ label: string, hint?: string, values: string[], placeholder?: string, onChange: (v: string[]) => void }} o */
export function chips(o) {
  const list = h("div.lm-chips");
  let values = [...o.values];
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-field.lm-chip-input", {
      placeholder: o.placeholder ?? "Add and press Enter",
      "aria-label": o.label,
    })
  );
  const draw = () =>
    fill(
      list,
      values.map((v, i) =>
        h(
          "span.lm-chip",
          null,
          h("code", null, JSON.stringify(v).slice(1, -1)),
          iconButton("x", `Remove ${v}`, () => {
            values = values.filter((_, j) => j !== i);
            draw();
            o.onChange(values);
          }),
        ),
      ),
    );
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value) return;
    e.preventDefault();
    const v = input.value.replace(/\\n/g, "\n");
    if (!values.includes(v)) values = [...values, v];
    input.value = "";
    draw();
    o.onChange(values);
  });
  draw();
  return h(
    "div.lm-ctl",
    null,
    h("div.lm-ctl-row", null, h("label.lm-ctl-label", { title: o.hint }, o.label)),
    list,
    input,
    o.hint ? h("div.lm-ctl-hint", null, o.hint) : null,
  );
}

/** A section of the inspector that folds. @param {string} title @param {import("./dom.js").IconName} ic @param {(HTMLElement | null)[]} children @param {{ open?: boolean, extra?: HTMLElement | null }} [o] */
export function section(title, ic, children, o = {}) {
  return h(
    "details.lm-sec",
    { open: o.open === false ? undefined : true },
    h(
      "summary.lm-sec-head",
      null,
      icon(ic),
      h("span", null, title),
      o.extra ?? null,
      icon("chevronDown", "lm-caret"),
    ),
    h("div.lm-sec-body", null, children),
  );
}
