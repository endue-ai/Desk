/**
 * The profile menu, under the chip of the profile in force (issue 295): every other profile to switch
 * to, "New profile", then the profile in force's own rows. It saves its layout and reverts it,
 * renames, deletes the person's own, and restores a plugin's profile the person saved over; another
 * profile is changed after switching to it. The arrow keys walk it; Esc and Tab close it, back to
 * the chip.
 */
import type { Mode } from "../modes/types";
import { revert, saveIntoMode, switchMode } from "./actions";
import type { ShellCtx } from "./context";
import { type Child, h } from "./dom";
import { icon } from "./icons";
import { originOf } from "./mode-edit";

export interface ModeMenuUi {
  rename(id: string): void;
  remove(id: string): void;
  /** Close the menu; `refocus` gives the focus back to the chip. */
  close(refocus: boolean): void;
}

export function modeMenu(
  ctx: ShellCtx,
  current: Mode,
  others: Mode[],
  changed: boolean,
  ui: ModeMenuUi,
): HTMLElement {
  const { id } = current.manifest;
  const item = (
    label: Child,
    key: string,
    run: () => void,
    enabled = true,
    extra: Record<string, string> = {},
  ) =>
    h(
      "button",
      {
        class: "menu-item",
        type: "button",
        role: "menuitem",
        "data-key": key,
        disabled: !enabled,
        onClick: run,
        ...extra,
      },
      label,
    );
  const rule = () => h("div", { class: "mode-menu-rule", role: "separator" });
  const then = (run: (id: string) => void) => () => {
    ui.close(false);
    run(id);
  };
  const profile = (mode: Mode) => {
    const { id: other, name, copiedFrom } = mode.manifest;
    return item(
      [
        icon(mode.manifest.icon, 16),
        h("span", { class: "mode-name" }, name),
        copiedFrom
          ? h("span", { class: "mode-copied" }, icon("copy", 12), copiedFrom.author)
          : null,
      ],
      `menu-switch-${other}`,
      () => {
        ui.close(true);
        switchMode(ctx, other);
      },
      true,
      {
        "data-mode": other,
        ...(copiedFrom
          ? { "aria-label": `${name} · ${ctx.tr("copiedFrom", { author: copiedFrom.author })}` }
          : {}),
      },
    );
  };
  const origin = originOf(ctx, id);
  const el = h(
    "div",
    {
      class: "popover mode-menu",
      role: "menu",
      "aria-label": `${ctx.tr("modes")} · ${current.manifest.name}`,
      "data-menu-for": id,
    },
    ...others.map(profile),
    others.length ? rule() : null,
    item(ctx.tr("newMode"), "menu-new", () => ctx.store.set({ dialog: "new-mode", popover: null })),
    rule(),
    item(ctx.tr("saveInto"), "menu-save", () => saveIntoMode(ctx), changed),
    item(ctx.tr("revert"), "menu-revert", () => revert(ctx), changed),
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
