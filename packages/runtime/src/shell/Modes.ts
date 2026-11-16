/**
 * Top left: one chip, the profile in force, with a chevron (issue 295). Pressing it, a right-click or
 * the menu key opens the profile menu (`mode-menu.ts`): every other profile to switch to, "New
 * profile", then the rows of the profile in force. Nothing unfolds on hover. The changed-layout mark
 * and the copied-from note stay on the chip.
 */
import type { Mode } from "../modes/types";
import { dirty, modeOf } from "./actions";
import type { ShellCtx } from "./context";
import { h, render } from "./dom";
import { icon } from "./icons";
import { mountModeDialogs } from "./mode-dialogs";
import { modeMenu } from "./mode-menu";

export function mountModes(root: HTMLElement, ctx: ShellCtx): () => void {
  const row = h("div", { class: "modes-row" });
  const menuSlot = h("div", { class: "modes-menu-slot" });
  const el = h("nav", { class: "modes", "aria-label": ctx.tr("modes") }, row, menuSlot);
  const dialogSlot = h("div", { class: "dialog-slot" });
  root.append(el, dialogSlot);
  /** The chip as drawn now: a draw replaces its element. */
  const chipNow = () => row.querySelector<HTMLElement>(".mode-chip") ?? el;
  const dialogs = mountModeDialogs(dialogSlot, ctx, chipNow);

  const open = () => ctx.store.get().popover === "mode-menu";
  const openMenu = () => {
    if (!open()) ctx.store.set({ popover: "mode-menu" });
    menuSlot.querySelector<HTMLElement>(".menu-item:not(:disabled)")?.focus();
  };
  const closeMenu = (refocus: boolean) => {
    if (refocus) chipNow().focus();
    if (open()) ctx.store.set({ popover: null });
  };

  const chip = (mode: Mode, changed: boolean): HTMLElement => {
    const { id, name, copiedFrom } = mode.manifest;
    return h(
      "button",
      {
        class: "mode-chip is-current",
        type: "button",
        // One key whichever profile is in force, so a switch keeps the focus on the chip.
        "data-key": "mode-current",
        "data-mode": id,
        "aria-haspopup": "menu",
        "aria-expanded": String(open()),
        "aria-label": copiedFrom
          ? `${name} · ${ctx.tr("copiedFrom", { author: copiedFrom.author })}`
          : name,
        onClick: () => (open() ? closeMenu(false) : openMenu()),
        onContextmenu: (e: MouseEvent) => {
          e.preventDefault();
          openMenu();
        },
      },
      icon(mode.manifest.icon, 16),
      h("span", { class: "mode-name" }, name),
      copiedFrom ? h("span", { class: "mode-copied" }, icon("copy", 12), copiedFrom.author) : null,
      changed
        ? h("span", { class: "dot dot-attention mode-dirty", title: ctx.tr("changed") })
        : null,
      icon("chevron-down", 14),
    );
  };

  const draw = () => {
    const s = ctx.store.get();
    const changed = dirty(s);
    const current = modeOf(s);
    render(row, () => [chip(current, changed)]);
    // A long name is cut short: the chip says it in full.
    const name = row.querySelector<HTMLElement>(".mode-name");
    if (name && name.scrollWidth > name.clientWidth)
      name.parentElement?.setAttribute("title", name.textContent ?? "");
    const others = s.modes
      // Profiles that only set settings (desk.profiles' own) are the palette's (⇧⌘M) to switch to;
      // Default, the way home, is always offered.
      .filter(
        (m) =>
          (m.lays || m.manifest.id === "default") &&
          m.manifest.id !== "base" &&
          m.manifest.id !== current.manifest.id,
      );
    render(menuSlot, () =>
      open()
        ? [
            modeMenu(ctx, current, others, changed, {
              rename: dialogs.rename,
              remove: dialogs.remove,
              close: closeMenu,
            }),
          ]
        : [],
    );
    el.classList.toggle("has-menu", open());
  };
  draw();
  const offs = [
    ctx.store.watch(
      (s) => [s.modes, s.modeId, s.wm.dirty, s.popover === "mode-menu", s.lang],
      draw,
    ),
    ctx.store.watch(
      (s) => s.dialog,
      (d) => (d === "new-mode" ? dialogs.create() : dialogs.close()),
    ),
  ];
  return () => {
    for (const off of offs) off();
    dialogs.close();
    el.remove();
    dialogSlot.remove();
  };
}
