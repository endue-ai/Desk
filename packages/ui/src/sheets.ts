/**
 * The hand-written sheets the desk serves as one `/_desk/base.css`, in order: the base (reset, focus
 * and the design system's kit classes) and the page patterns (layouts and feedback, ADR 0265). Each
 * source stays one concern; a page links one sheet. The build (vite.config.ts) and the runtime e2e's
 * fixture server join them the same way.
 */
export const BASE_SHEETS = ["base.css", "patterns.css"] as const;

/** The served `base.css`: every sheet of `BASE_SHEETS`, read by `read`, one after another. */
export function joinSheets(read: (name: (typeof BASE_SHEETS)[number]) => string): string {
  return `${BASE_SHEETS.map((name) => read(name).trimEnd()).join("\n\n")}\n`;
}
