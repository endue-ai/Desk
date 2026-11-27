// The number editor (PG-40): a whole-number column takes digits within its type's range (smallint,
// integer, bigint), any other takes a decimal as PostgreSQL reads one, with NaN and Infinity. The
// value stays as typed, less the space around it.

import { t as messageText } from "../strings/index.js";
import { field } from "./panel.js";

/** @typedef {import("./resolve.js").Editor} Editor */

const RANGES = /** @type {Record<string, [bigint, bigint, string]>} */ ({
  int2: [-32768n, 32767n, "smallint"],
  int4: [-2147483648n, 2147483647n, "integer"],
  int8: [-9223372036854775808n, 9223372036854775807n, "bigint"],
});
const WHOLE = /^[-+]?[0-9]+$/u;
const DECIMAL = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/u;
const SPECIAL = /^[-+]?(?:nan|inf|infinity)$/iu;

export const number = {
  /** @param {string} text @param {Editor} editor */
  check(text, editor) {
    const t = text.trim();
    if (editor.integer) {
      const range = RANGES[editor.integer];
      const holds = range
        ? `${range[2]} holds whole numbers from ${range[0]} to ${range[1]}`
        : `${editor.type} holds whole numbers`;
      if (!WHOLE.test(t))
        return {
          error: messageText("cellEditors.number.isNotAWholeNumber", {
            value: String(t || messageText("cellEditors.number.nothing")),
            holds: String(holds),
          }),
        };
      if (range && (BigInt(t) < range[0] || BigInt(t) > range[1]))
        return {
          error: messageText("cellEditors.number.isOutOfRange", {
            t: String(t),
            holds: String(holds),
          }),
        };
      return { value: t };
    }
    if (DECIMAL.test(t) || SPECIAL.test(t)) return { value: t };
    return {
      error: messageText("cellEditors.number.isNotANumberWriteDigits", {
        value: String(t || messageText("cellEditors.number.nothing")),
      }),
    };
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const f = field(ctx, {
      check: (text) => number.check(text, ctx.editor),
      example: ctx.editor.integer ? "42" : "1234.5",
    });
    return { el: f.input, read: f.read, focus: f.focus };
  },
};
