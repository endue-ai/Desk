// The enum editor (PG-40): its labels from pg_enum (or MySQL's enum(...)) as a list, in their order.
// The arrows, Home and End move, a letter goes to the next label it starts, a click keeps; a value
// is one of the labels, exactly.

import { el } from "../dom.js";
import { t } from "../strings/index.js";

/** @typedef {import("./resolve.js").Editor} Editor */

let lists = 0;

export const enumKind = {
  /** @param {string} text @param {Editor} editor */
  check(text, editor) {
    return editor.labels.includes(text)
      ? { value: text }
      : {
          error: t("cellEditors.enum.isNotALabelOfIt", {
            value: String(text || t("cellEditors.enum.nothing")),
            type: String(editor.type),
            value2: String(editor.labels.join(", ")),
          }),
        };
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const { doc, editor } = ctx;
    const id = `cell-enum-${++lists}`;
    let at = editor.labels.indexOf(ctx.value ?? "");
    const options = editor.labels.map((label, i) =>
      el(doc, "li", { role: "option", id: `${id}-${i}`, "data-index": String(i) }, label),
    );
    const list = el(
      doc,
      "ul",
      {
        class: "cell-editor-options",
        role: "listbox",
        tabindex: "0",
        "aria-label": t("cellEditors.enum.sLabels", { name: String(ctx.name) }),
      },
      ...options,
    );
    const draw = () => {
      options.forEach((o, i) => {
        o.setAttribute("aria-selected", String(i === at));
      });
      if (at >= 0) {
        list.setAttribute("aria-activedescendant", `${id}-${at}`);
        options[at]?.scrollIntoView?.({ block: "nearest" });
      } else list.removeAttribute("aria-activedescendant");
    };
    list.addEventListener("click", (event) => {
      const option = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[role=option]");
      if (!option) return;
      at = Number(/** @type {HTMLElement} */ (option).dataset.index);
      draw();
      ctx.keep();
    });
    draw();
    const move = (/** @type {number} */ to) => {
      at = Math.max(0, Math.min(options.length - 1, to));
      draw();
    };
    return {
      el: list,
      read: () => (at >= 0 ? { value: editor.labels[at] ?? "" } : { value: ctx.value }),
      focus: () => list.focus(),
      /** @param {KeyboardEvent} event */
      keys(event) {
        if (event.altKey || event.metaKey || event.ctrlKey) return false;
        if (event.key === "ArrowDown") move(at + 1);
        else if (event.key === "ArrowUp") move(at < 0 ? options.length - 1 : at - 1);
        else if (event.key === "Home") move(0);
        else if (event.key === "End") move(options.length - 1);
        else if (event.key.length === 1 && event.key !== " ") {
          const key = event.key.toLowerCase();
          const n = editor.labels.length;
          for (let step = 1; step <= n; step++) {
            const i = (at + step + n) % n;
            if (editor.labels[i]?.toLowerCase().startsWith(key)) {
              move(i);
              break;
            }
          }
        } else return false;
        return true;
      },
    };
  },
};
