/** Sample surface: plain notes. */
import type { ShellCtx } from "../../shell/context";
import { h } from "../../shell/dom";

export function notesBody(ctx: ShellCtx): HTMLElement {
  const ko = ctx.store.get().lang === "ko";
  return h(
    "textarea",
    { class: "notes-body", "aria-label": ctx.tr("surfaceNotes"), spellcheck: "false" },
    ko
      ? "모드 이름은 짧게.\n표면은 가장자리에."
      : "Keep mode names short.\nSurfaces live at the edges.",
  );
}
