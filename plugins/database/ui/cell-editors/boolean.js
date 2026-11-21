// The boolean editor (PG-40): a toggle of true and false, and NULL where the column allows it. Keys:
// t, f and n choose, Space flips true and false, the arrows move; the value is t or f, as the server
// writes it. Text is read with PostgreSQL's words (yes, on, 1 ...).

import { el } from "../dom.js";

const TRUE = /^(?:t|true|y|yes|on|1)$/iu;
const FALSE = /^(?:f|false|n|no|off|0)$/iu;

/** A boolean's text as t or f, or undefined when it is not one. */
export const boolOf = (/** @type {string} */ text) =>
  TRUE.test(text.trim()) ? "t" : FALSE.test(text.trim()) ? "f" : undefined;

export const boolean = {
  check(/** @type {string} */ text) {
    const value = boolOf(text);
    return value
      ? { value }
      : { error: `${text.trim() || "Nothing"} is not a boolean: write true or false.` };
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const { doc, editor } = ctx;
    /** @type {(string | null)[]} */
    const values = editor.nullable ? ["t", "f", null] : ["t", "f"];
    /** @type {string | null | undefined} */
    let chosen =
      ctx.value === null ? (editor.nullable ? null : undefined) : boolOf(ctx.value ?? "");
    const buttons = values.map((value) =>
      el(
        doc,
        "button",
        { type: "button", class: "desk-tab", "data-value": value ?? "null", tabindex: "-1" },
        value === null ? "NULL" : value === "t" ? "true" : "false",
      ),
    );
    const group = el(
      doc,
      "div",
      {
        class: "desk-tabs",
        role: "group",
        tabindex: "0",
        "aria-label": `${ctx.name}: true or false`,
      },
      ...buttons,
    );
    const draw = () =>
      buttons.forEach((b, i) => {
        b.setAttribute("aria-pressed", String(chosen !== undefined && values[i] === chosen));
      });
    const pick = (/** @type {string | null} */ value) => {
      chosen = value;
      draw();
    };
    buttons.forEach((b, i) => {
      b.addEventListener("click", () => pick(values[i] ?? null));
    });
    draw();
    return {
      el: group,
      read: () => ({ value: chosen === undefined ? ctx.value : chosen }),
      focus: () => group.focus(),
      /** @param {KeyboardEvent} event */
      keys(event) {
        if (event.altKey || event.metaKey || event.ctrlKey) return false;
        const at = chosen === undefined ? -1 : values.indexOf(chosen);
        if (event.key === "t") pick("t");
        else if (event.key === "f") pick("f");
        else if (event.key === "n" && editor.nullable) pick(null);
        else if (event.key === " ") pick(chosen === "t" ? "f" : "t");
        else if (event.key === "ArrowRight")
          pick(values[Math.min(values.length - 1, at + 1)] ?? null);
        else if (event.key === "ArrowLeft") pick(values[Math.max(0, at - 1)] ?? null);
        else return false;
        return true;
      },
    };
  },
};
