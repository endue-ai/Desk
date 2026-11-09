/**
 * A profile's menu, under its chip. The profile in force saves its layout, saves it as a new profile
 * and reverts it; every profile renames, the person's own deletes, and a plugin's profile the person
 * saved over restores. The arrow keys walk it; Esc and Tab close it, back to its chip.
 */
import type { Mode } from "../modes/types";
import { revert, saveIntoMode } from "./actions";
import type { ShellCtx } from "./context";
import { h } from "./dom";
import { originOf } from "./mode-edit";

export interface ModeMenuUi {
  rename(id: string): void;
  remove(id: string): void;
  /** Close the menu; `refocus` gives the focus back to its chip. */
  close(refocus: boolean): void;
}

export function modeMenu(
  ctx: ShellCtx,
  mode: Mode,
  current: boolean,
  changed: boolean,
  ui: ModeMenuUi,
): HTMLElement {
  const { id } = mode.manifest;
  const item = (label: string, key: string, run: () => void, enabled = true) =>
    h(
      "button",
      {
        class: "menu-item",
        type: "button",
        role: "menuitem",
        "data-key": key,
        disabled: !enabled,
        onClick: run,
      },
      label,
    );
  const then = (run: (id: string) => void) => () => {
    ui.close(false);
    run(id);
  };
  const origin = originOf(ctx, id);
  const own = current
    ? [
        item(ctx.tr("saveInto"), "menu-save", () => saveIntoMode(ctx), changed),
        item(ctx.tr("saveAsNew"), "menu-new", () =>
          ctx.store.set({ dialog: "new-mode", popover: null }),
        ),
        item(ctx.tr("revert"), "menu-revert", () => revert(ctx), changed),
        h("div", { class: "mode-menu-rule", role: "separator" }),
      ]
    : [];
  const el = h(
    "div",
    {
      class: "popover mode-menu",
      role: "menu",
      "aria-label": `${ctx.tr("modes")} · ${mode.manifest.name}`,
      "data-menu-for": id,
    },
    ...own,
    item(ctx.tr("renameMode"), "menu-rename", then(ui.rename)),
    origin === "own" ? item(ctx.tr("removeMode"), "menu-remove", then(ui.remove)) : null,
    origin === "changed" ? item(ctx.tr("restoreMode"), "menu-restore", then(ui.remove)) : null,
  );
  el.addEventListener("keydown", (e) => {
    const items = [...el.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)")];
    const at = items.indexOf(el.ownerDocument.activeElement as HTMLElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") ui.close(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return el;
}
