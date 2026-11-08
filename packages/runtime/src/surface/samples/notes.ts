/**
 * Sample surface: plain notes. The notes are a universal text view with inline data (ADR 0103),
 * under a line where the person writes another: Enter adds it, Shift+Enter breaks the line. Kept
 * while the pane is open, as the sample always was.
 */
import type { UniversalEntry, UniversalView } from "@endue-ai/bridge";
import type { ShellCtx } from "../../shell/context";
import { h } from "../../shell/dom";
import { universalBody } from "./universal";

const NOTES = {
  ko: ["프로필 이름은 짧게.", "표면은 가장자리에."],
  en: ["Keep profile names short.", "Surfaces live at the edges."],
};

export function notesView(lang: "ko" | "en", added: readonly string[] = []): UniversalView {
  const entries: UniversalEntry[] = [...NOTES[lang], ...added].map((text, i) => ({
    id: `note-${i + 1}`,
    text,
  }));
  return { type: "text", source: { data: { entries } } };
}

export function notesBody(ctx: ShellCtx): HTMLElement {
  const lang = ctx.store.get().lang;
  const added: string[] = [];
  const shown = universalBody(ctx, notesView(lang));
  const input = h("textarea", {
    class: "notes-input",
    rows: "2",
    "aria-label": ctx.tr("noteAdd"),
    placeholder: ctx.tr("noteAdd"),
    spellcheck: "false",
  }) as HTMLTextAreaElement;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    added.push(text);
    const view = notesView(lang, added);
    (shown as HTMLElement & { data: unknown }).data =
      "data" in view.source ? view.source.data : null;
    input.value = "";
  });
  return h("div", { class: "notes" }, shown, input);
}
