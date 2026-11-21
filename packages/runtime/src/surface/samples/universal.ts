/**
 * A sample surface's universal view (ADR 0103) drawn in a pane by `<desk-universal-view>`: the
 * view's inline data, the shell's language and its wall clock, so a sample reads the same on every
 * machine. The pane's title bar names it, so the view draws no title of its own.
 */
import type { UniversalView } from "@endue-ai/bridge";
import { defineElements } from "@endue-ai/ui/elements";
import { moduleText } from "../../i18n/messages";
import type { ShellCtx } from "../../shell/context";
import en from "../messages/en.json";
import ko from "../messages/ko.json";

/** The surfaces' words; a view formats dates and numbers in `surface.locale` (ADR 0250). */
const text = moduleText("surface", { en, ko });

export function universalBody(ctx: ShellCtx, view: UniversalView): HTMLElement {
  defineElements();
  const element = document.createElement("desk-universal-view");
  const { source, ...shown } = view;
  element.view = shown;
  element.data = "data" in source ? source.data : null;
  element.className = "sample-view";
  element.setAttribute("locale", text(ctx.store.get().lang, "locale"));
  element.setAttribute("now", new Date(ctx.wall()).toISOString());
  element.setAttribute("state", "ready");
  return element;
}
