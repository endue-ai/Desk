/**
 * Top left: the current profile, the others unfolding on hover or focus, and "+" for a new one. The
 * row unfolds to its chips' width, never past the desktop switcher; when they do not fit, it scrolls
 * sideways. A click on the profile in force, or a right-click (or the menu key) on any, opens that
 * profile's menu (`mode-menu.ts`).
 */
import { easeOutExpo } from "../ease";
import type { Mode } from "../modes/types";
import { dirty, modeOf, switchMode } from "./actions";
import type { ShellCtx } from "./context";
import { h, listen, render } from "./dom";
import { icon } from "./icons";
import { mountModeDialogs } from "./mode-dialogs";
import { modeMenu } from "./mode-menu";

/** What the unfolded row keeps clear before the desktop switcher. */
const CLEARANCE = 16;

export function mountModes(root: HTMLElement, ctx: ShellCtx): () => void {
  const others = h("div", { class: "modes-more" });
  const currentSlot = h("div", { class: "modes-current" });
  const menuSlot = h("div", { class: "modes-menu-slot" });
  const add = h(
    "button",
    {
      class: "add-button mode-add",
      type: "button",
      "data-key": "mode-add",
      "aria-label": ctx.tr("newMode"),
      title: ctx.tr("newMode"),
      onClick: () => ctx.store.set({ dialog: "new-mode", popover: null }),
    },
    icon("plus", 16),
  );
  const row = h("div", { class: "modes-row" }, currentSlot, others);
  const el = h("nav", { class: "modes", "aria-label": ctx.tr("modes") }, row, add, menuSlot);
  const dialogSlot = h("div", { class: "dialog-slot" });
  root.append(el, dialogSlot);
  const dialogs = mountModeDialogs(dialogSlot, ctx, () => add);

  /** Whose menu is open, while the store says a profile menu is. */
  let menuFor: string | null = null;
  const chipOf = (id: string) =>
    [...el.querySelectorAll<HTMLElement>(".mode-chip")].find((c) => c.dataset.mode === id);
  const openMenu = (id: string) => {
    menuFor = id;
    if (ctx.store.get().popover === "mode-menu") draw();
    else ctx.store.set({ popover: "mode-menu" });
    menuSlot.querySelector<HTMLElement>(".menu-item:not(:disabled)")?.focus();
  };
  const closeMenu = (refocus: boolean) => {
    // The chip takes the focus before the menu goes, so the row never folds under it.
    if (refocus && menuFor) chipOf(menuFor)?.focus();
    if (ctx.store.get().popover === "mode-menu") ctx.store.set({ popover: null });
  };

  const chip = (mode: Mode, current: boolean, changed: boolean): HTMLElement => {
    const { id, name, copiedFrom } = mode.manifest;
    const open = ctx.store.get().popover === "mode-menu" && menuFor === id;
    return h(
      "button",
      {
        class: `mode-chip${current ? " is-current" : ""}`,
        type: "button",
        "data-key": `mode-${id}`,
        "data-mode": id,
        "aria-pressed": current ? "true" : "false",
        "aria-haspopup": current ? "menu" : undefined,
        "aria-expanded": current ? String(open) : undefined,
        "aria-label": copiedFrom
          ? `${name} · ${ctx.tr("copiedFrom", { author: copiedFrom.author })}`
          : name,
        onClick: () => {
          if (!current) return switchMode(ctx, id);
          if (open) closeMenu(false);
          else openMenu(id);
        },
        onContextmenu: (e: MouseEvent) => {
          e.preventDefault();
          openMenu(id);
        },
      },
      icon(mode.manifest.icon, 16),
      h("span", { class: "mode-name" }, name),
      copiedFrom ? h("span", { class: "mode-copied" }, icon("copy", 12), copiedFrom.author) : null,
      current && changed
        ? h("span", { class: "dot dot-attention mode-dirty", title: ctx.tr("changed") })
        : null,
    );
  };

  let shown = 0;
  /** The room the row has: from its start to the desktop switcher (else the edge of the layer). */
  const room = () => {
    const switcher = root.querySelector<HTMLElement>(".desktops")?.getBoundingClientRect();
    const edge = switcher?.width ? switcher.left : root.getBoundingClientRect().right;
    return Math.max(0, Math.floor(edge - CLEARANCE - others.getBoundingClientRect().left));
  };
  /** Which ends of the row hide chips: faded, so the row reads as one that scrolls. */
  const edges = () => {
    const start = others.scrollLeft > 1;
    const end = others.scrollLeft + others.clientWidth < others.scrollWidth - 1;
    const more = start && end ? "both" : start ? "start" : end ? "end" : "";
    if (more) others.dataset.more = more;
    else delete others.dataset.more;
  };
  const fit = () => {
    const width = Math.min(others.scrollWidth, room());
    others.style.maxWidth = `${Math.round(width * shown)}px`;
    others.style.opacity = String(Math.round(shown * 1000) / 1000);
    if (shown === 0) others.scrollLeft = 0;
    edges();
  };

  const draw = () => {
    const s = ctx.store.get();
    const changed = dirty(s);
    const current = modeOf(s);
    if (s.popover !== "mode-menu") menuFor = null;
    else menuFor ??= current.manifest.id;
    const shownModes = s.modes
      // Profiles that only set settings (desk.profiles' own) are the palette's (⇧⌘M) to switch to;
      // Default, the way home, is always offered.
      .filter(
        (m) =>
          (m.lays || m.manifest.id === "default") &&
          m.manifest.id !== "base" &&
          m.manifest.id !== current.manifest.id,
      );
    render(currentSlot, () => [chip(current, true, changed)]);
    render(others, () => shownModes.map((m) => chip(m, false, false)));
    others.inert = !s.modesOpen;
    // A long name is cut short: the chip says it in full.
    for (const name of el.querySelectorAll<HTMLElement>(".mode-name")) {
      if (name.scrollWidth > name.clientWidth)
        name.parentElement?.setAttribute("title", name.textContent ?? "");
    }
    const menuMode = menuFor
      ? [current, ...shownModes].find((m) => m.manifest.id === menuFor)
      : undefined;
    render(menuSlot, () =>
      menuMode
        ? [
            modeMenu(ctx, menuMode, menuMode === current, changed, {
              rename: dialogs.rename,
              remove: dialogs.remove,
              close: closeMenu,
            }),
          ]
        : [],
    );
    el.classList.toggle("has-menu", menuMode !== undefined);
    // The menu sits under its chip.
    const menu = menuSlot.firstElementChild as HTMLElement | null;
    const under = menuMode && chipOf(menuMode.manifest.id);
    if (menu && under) {
      const left = under.getBoundingClientRect().left - el.getBoundingClientRect().left;
      menu.style.left = `${Math.max(0, Math.round(left))}px`;
    }
    fit();
  };
  let animation = 0;
  const unfold = (open: boolean) => {
    const id = ++animation;
    const from = shown;
    const to = open ? 1 : 0;
    others.inert = !open;
    return ctx.ticker.animate(ctx.reduced() ? 0 : 400, easeOutExpo, (t) => {
      if (id !== animation) return;
      shown = from + (to - from) * t;
      fit();
    });
  };
  draw();
  const offs = [
    ctx.store.watch(
      (s) => [s.modes, s.modeId, s.session, s.desktops, s.popover === "mode-menu", s.lang],
      draw,
    ),
    ctx.store.watch(
      (s) => s.modesOpen,
      (open) => void unfold(open),
    ),
    ctx.store.watch(
      (s) => s.dialog,
      (d) => (d === "new-mode" ? dialogs.create() : dialogs.close()),
    ),
    listen(row, "pointerenter", () => ctx.store.set({ modesOpen: true })),
    listen(el, "pointerleave", () => {
      if (!el.contains(document.activeElement)) ctx.store.set({ modesOpen: false });
    }),
    listen(row, "focusin", () => ctx.store.set({ modesOpen: true })),
    listen(el, "focusout", (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (next && el.contains(next)) return;
      // Chromium says focusout too when a draw replaces the focused chip (WebKit says nothing). Once
      // the draw is done: its new copy may have the focus back, and a chip the draw took away is no
      // move out of the row either (leaving the row with the pointer folds it then).
      const left = e.target as Node;
      queueMicrotask(() => {
        if (el.contains(document.activeElement) || !left.isConnected) return;
        ctx.store.set({ modesOpen: false });
      });
    }),
    // A wheel scrolls a long row sideways, as the desktop switcher's.
    listen(
      others,
      "wheel",
      (e) => {
        if (others.scrollWidth <= others.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY))
          return;
        e.preventDefault();
        others.scrollLeft += e.deltaY;
      },
      { passive: false },
    ),
    listen(others, "scroll", edges),
    listen(window, "resize", fit),
  ];
  return () => {
    for (const off of offs) off();
    dialogs.close();
    el.remove();
    dialogSlot.remove();
  };
}
