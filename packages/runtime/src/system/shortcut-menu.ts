/**
 * A shortcut's menu (ADR 0274), beside it: Move up, Move down and Remove from shortcuts. A
 * right-click on the shortcut opens it, and so do Shift+F10 and the context menu key while it has
 * the focus. Its first row has the focus; the arrows, Home and End walk its rows, Escape closes it.
 */
import type { Lang } from "../shell/copy";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { walkButtons } from "./account-menu";
import { shortcutText } from "./shortcut-copy";

export interface MenuOptions {
  lang: Lang;
  /** The shortcut's name. */
  name: string;
  /** Whether it is first or last on the bar: it moves no further. */
  first: boolean;
  last: boolean;
  /** Where the menu's top is, level with the shortcut, in its layer's pixels. */
  top: number;
  move(by: -1 | 1): void;
  remove(): void;
  close(): void;
}

/** Whether a key on a focused shortcut asks for its menu. */
export const asksForMenu = (event: KeyboardEvent): boolean =>
  event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

export function shortcutMenu(o: MenuOptions): HTMLElement {
  const tr = (key: Parameters<typeof shortcutText>[1]) => shortcutText(o.lang, key);
  const item = (key: string, label: string, glyph: string, run: () => void, disabled = false) =>
    h(
      "button",
      {
        class: "menu-item shortcut-menu-item",
        type: "button",
        role: "menuitem",
        "data-key": `shortcut-menu-${key}`,
        disabled,
        onClick: run,
      },
      icon(glyph, 16),
      h("span", { class: "pop-text" }, label),
    );
  const menu = h(
    "div",
    {
      class: "popover shortcut-menu",
      role: "menu",
      tabindex: "-1",
      "aria-label": shortcutText(o.lang, "menu", { name: o.name }),
      style: { top: `${Math.round(o.top)}px` },
      onKeydown: (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "Escape") o.close();
        else if (!walkButtons(menu, event.key)) return;
        event.preventDefault();
        event.stopPropagation();
      },
    },
    item("up", tr("moveUp"), "raise", () => o.move(-1), o.first),
    item("down", tr("moveDown"), "lower", () => o.move(1), o.last),
    item("remove", tr("remove"), "close", o.remove),
  );
  return menu;
}
