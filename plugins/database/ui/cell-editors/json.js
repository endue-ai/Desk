// The JSON editor (PG-40) of json and jsonb: the value laid out by its tokens (json-text.js), checked
// as strict JSON with the line and column of what is wrong, Format (Alt+F) to lay it out again,
// Mod+Enter to keep. A value that only differs in space from the cell's is no change.

import { t } from "../strings/index.js";
import { formatJson, sameJson, scanJson } from "./json-text.js";
import { field, textOf } from "./panel.js";

export const json = {
  check(/** @type {string} */ text) {
    const scanned = scanJson(text);
    return "error" in scanned ? scanned : { value: text.trim() };
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const original = textOf(ctx.value);
    const f = field(ctx, {
      text: formatJson(original) ?? original,
      check: json.check,
      multiline: true,
      example: '{"key": "value"}',
    });
    const format = () => {
      const laid = formatJson(f.input.value);
      if (laid === undefined) {
        const done = json.check(f.input.value);
        if ("error" in done) ctx.fail(done.error);
      } else f.input.value = laid;
      f.input.focus();
    };
    return {
      el: f.input,
      multiline: true,
      focus: f.focus,
      read() {
        const done = f.read();
        if ("value" in done && done.value !== null && original && sameJson(done.value, original))
          return { value: ctx.value };
        return done;
      },
      tools: [{ label: t("cellEditors.json.format"), name: "format", key: "KeyF", run: format }],
    };
  },
};
