/**
 * The desktops overview (ADR 0117): every desktop side by side, its windows to scale and live.
 * Choose one to go there; drag a window from one onto another to move it; F2 renames the desktop in
 * focus and Delete removes it; arrow keys move between them; Esc or a click outside closes it.
 */
import { desktopId, desktopsOf, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { containModal } from "../shell/modal";
import { moveWindowTo, newDesktop, switchTo, tx } from "./actions";
import type { Dialogs } from "./dialogs";
import { deskMap } from "./map";
import { MAX_DESKTOPS } from "./model";

const WINDOW = "application/x-desk-window";

export interface Overview {
  /** Open (true), close (false) or toggle it. */
  toggle(open?: boolean): void;
  dispose(): void;
}

export function mountOverview(root: HTMLElement, ctx: ShellCtx, dialogs: Dialogs): Overview {
  const doc = root.ownerDocument;
  const grid = h("div", { class: "overview-grid" });
  const panel = h(
    "section",
    {
      class: "dialog desktops-overview-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "desktops-overview-title",
    },
    h("h2", { class: "dialog-title", id: "desktops-overview-title" }),
    h("p", { class: "dialog-hint" }),
    grid,
  );
  const scrim = h("div", { class: "scrim desktops-overview" }, panel);
  let release: (() => void) | undefined;
  let watching: (() => void) | undefined;

  const card = (id: string, name: string, n: number, here: boolean) => {
    const s = ctx.store.get();
    const count = windowsOf(s, id).length;
    return h(
      "button",
      {
        class: `btn btn-outline overview-card${here ? " is-current" : ""}`,
        type: "button",
        "data-key": `overview-${id}`,
        "data-desktop-id": id,
        "aria-current": here ? "true" : undefined,
        "aria-label": `${n} · ${name} · ${count ? tx(ctx, "windows", { n: count }) : tx(ctx, "empty")}`,
        onClick: () => {
          close();
          switchTo(ctx, id);
        },
        onDragover: (e: DragEvent) => {
          if (!e.dataTransfer?.types.includes(WINDOW)) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add("is-drop-target");
        },
        onDragleave: (e: DragEvent) =>
          (e.currentTarget as HTMLElement).classList.remove("is-drop-target"),
        onDrop: (e: DragEvent) => {
          const window = e.dataTransfer?.getData(WINDOW);
          e.preventDefault();
          if (window) moveWindowTo(ctx, window, id);
        },
      },
      deskMap(ctx, s, id, { titles: true, drag: true }),
      h(
        "span",
        { class: "overview-name" },
        h("span", { class: "overview-meta" }, n),
        h("strong", {}, name),
        h(
          "span",
          { class: "overview-meta" },
          count ? tx(ctx, "windows", { n: count }) : tx(ctx, "empty"),
        ),
      ),
    );
  };

  const draw = () => {
    const s = ctx.store.get();
    const here = desktopId(s);
    const list = desktopsOf(s);
    panel.querySelector(".dialog-title")?.replaceChildren(tx(ctx, "overviewTitle"));
    panel.querySelector(".dialog-hint")?.replaceChildren(tx(ctx, "overviewHint"));
    panel.setAttribute("aria-label", tx(ctx, "overviewTitle"));
    render(grid, () => [
      ...list.map((d, i) => card(d.id, d.name, i + 1, d.id === here)),
      h(
        "button",
        {
          class: "add-button overview-add",
          type: "button",
          "data-key": "overview-add",
          "aria-label": tx(ctx, "newDesktop"),
          title: tx(ctx, "newDesktop"),
          disabled: list.length >= MAX_DESKTOPS,
          onClick: () => newDesktop(ctx, undefined, false),
        },
        icon("plus", 20),
      ),
    ]);
  };

  const close = () => {
    if (!scrim.isConnected) return;
    watching?.();
    watching = undefined;
    scrim.remove();
    release?.();
    release = undefined;
    if (ctx.store.get().popover === "desktops-overview") ctx.store.set({ popover: null });
  };
  const open = () => {
    if (scrim.isConnected) return;
    ctx.store.set({ popover: "desktops-overview" });
    draw();
    root.append(scrim);
    const fallback = root.querySelector<HTMLElement>(".desktops .desktop-button.is-active") ?? root;
    release = containModal(panel, close, fallback);
    watching = ctx.store.watch(
      (s) => [desktopsOf(s), s.desktop, s.session, s.pan, s.adopted, s.focused, s.lang],
      draw,
    );
    grid.querySelector<HTMLElement>(".overview-card.is-current")?.focus();
  };

  const columns = () => {
    const cards = [...grid.querySelectorAll<HTMLElement>(".overview-card, .overview-add")];
    const top = cards[0]?.offsetTop;
    return Math.max(1, cards.filter((c) => c.offsetTop === top).length);
  };
  const offs = [
    // A click outside, Esc through the desk or another popover closes it.
    ctx.store.watch(
      (s) => s.popover,
      (popover) => popover !== "desktops-overview" && close(),
    ),
    listen(scrim, "click", (e) => e.target === scrim && close()),
    listen(grid, "keydown", (e) => {
      const cards = [...grid.querySelectorAll<HTMLElement>(".overview-card, .overview-add")];
      const at = cards.indexOf(doc.activeElement as HTMLElement);
      if (at < 0) return;
      const id = cards[at]?.getAttribute("data-desktop-id");
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[
        e.key
      ];
      if (step) cards[Math.max(0, Math.min(cards.length - 1, at + step))]?.focus();
      else if (e.key === "F2" && id) dialogs.rename(id);
      else if ((e.key === "Delete" || e.key === "Backspace") && id) dialogs.remove(id);
      else return;
      e.preventDefault();
    }),
    // Windows in the maps are drag handles; they carry their id to the card they are dropped on.
    listen(grid, "dragstart", (e) => {
      const window = (e.target as Element | null)
        ?.closest?.("[data-window]")
        ?.getAttribute("data-window");
      if (!window || !e.dataTransfer) return;
      e.dataTransfer.setData(WINDOW, window);
      e.dataTransfer.effectAllowed = "move";
    }),
    listen(grid, "dragend", () => {
      for (const c of grid.querySelectorAll(".is-drop-target"))
        c.classList.remove("is-drop-target");
    }),
  ];
  return {
    toggle(want) {
      const next = want ?? !scrim.isConnected;
      if (next) open();
      else close();
    },
    dispose() {
      for (const off of offs) off();
      close();
    },
  };
}
