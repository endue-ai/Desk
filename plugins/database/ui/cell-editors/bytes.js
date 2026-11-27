// The bytes editor (PG-40) of bytea (and MySQL's and SQLite's binary columns): hex with its size,
// loaded from a file the person picks (Alt+O) and saved to one (Alt+S) through the plugin's actions
// cellFileLoad and cellFileSave (features/cell-values/). PostgreSQL writes \x and lower case hex,
// MySQL and SQLite 0x.

import { el } from "../dom.js";
import { t } from "../strings/index.js";
import { field } from "./panel.js";

/** @typedef {import("./resolve.js").Editor} Editor */

const HEX = /^(?:\\x|0x)((?:[0-9a-fA-F]{2}\s*)*)$/u;

/** How many bytes a hex text holds, or undefined when it is not hex. */
const sizeOf = (/** @type {string} */ text) => {
  const hex = HEX.exec(text.trim());
  return hex ? (hex[1] ?? "").replace(/\s/gu, "").length / 2 : undefined;
};
const bytesWord = (/** @type {number} */ n) => `${n} byte${n === 1 ? "" : "s"}`;

export const bytes = {
  /** @param {string} text @param {Editor} editor */
  check(text, editor) {
    const hex = HEX.exec(text.trim());
    if (!hex)
      return {
        error: t("cellEditors.bytes.bytesAreAndTwoHexDigits", {
          prefix: String(editor.prefix),
          prefix2: String(editor.prefix),
        }),
      };
    const digits = (hex[1] ?? "").replace(/\s/gu, "");
    return {
      value: `${editor.prefix}${editor.prefix === "\\x" ? digits.toLowerCase() : digits.toUpperCase()}`,
    };
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const { doc, editor } = ctx;
    const f = field(ctx, {
      check: (text) => bytes.check(text, editor),
      multiline: true,
      example: `${editor.prefix}0102ff`,
    });
    const size = el(doc, "p", { class: "cell-editor-size desk-muted", "aria-live": "polite" });
    let file = "";
    const draw = () => {
      const n = sizeOf(f.input.value);
      size.textContent =
        n === undefined
          ? t("cellEditors.bytes.notHexYet")
          : `${bytesWord(n)}${file ? ` · ${file}` : ""}`;
    };
    f.input.addEventListener("input", () => {
      file = "";
      draw();
    });
    draw();
    const load = async () => {
      const loaded = /** @type {{ hex: string, name: string } | undefined} */ (
        await ctx.act("cellFileLoad")
      );
      if (!loaded) return;
      const done = bytes.check(loaded.hex, editor);
      f.input.value = "value" in done ? (done.value ?? "") : loaded.hex;
      file = loaded.name;
      ctx.clear();
      draw();
      f.input.focus();
    };
    const save = () => {
      const done = bytes.check(f.input.value, editor);
      if ("error" in done) return ctx.fail(done.error);
      return ctx.act("cellFileSave", done.value, ctx.name);
    };
    return {
      el: el(doc, "div", { class: "cell-editor-body" }, f.input, size),
      multiline: true,
      read: f.read,
      focus: f.focus,
      tools: [
        { label: t("cellEditors.bytes.loadFromFile"), name: "load", key: "KeyO", run: load },
        { label: t("cellEditors.bytes.saveToFile"), name: "save", key: "KeyS", run: save },
      ],
    };
  },
};
