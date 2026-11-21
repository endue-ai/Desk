// The UUID editor (PG-40): the forms PostgreSQL reads (32 hex digits, a hyphen after any group of
// four, braces around), and Generate (Alt+G) for a new random one.

import { field } from "./panel.js";

const FORM = /^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/iu;

export const uuid = {
  check(/** @type {string} */ text) {
    const t = text.trim();
    const inner = t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : t;
    return FORM.test(inner)
      ? { value: t }
      : { error: "A UUID is 32 hex digits, as a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11." };
  },
  /** @param {import("./panel.js").Ctx} ctx */
  view(ctx) {
    const f = field(ctx, { check: uuid.check, example: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" });
    const generate = () => {
      f.input.value = ctx.doc.defaultView?.crypto.randomUUID() ?? "";
      ctx.clear();
      f.input.focus();
    };
    return {
      el: f.input,
      read: f.read,
      focus: f.focus,
      tools: [{ label: "Generate", name: "generate", key: "KeyG", run: generate }],
    };
  },
};
