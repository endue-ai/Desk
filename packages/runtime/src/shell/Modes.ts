/** Top left: the current mode, the others unfolding on hover or focus, and "+" for a new mode. */
import { easeOutExpo } from "../ease";
import type { Mode } from "../modes/types";
import { dirty, modeOf, revert, saveAsNewMode, saveIntoMode, switchMode } from "./actions";
import type { ShellCtx } from "./context";
import { h, listen, render } from "./dom";
import { icon } from "./icons";

function chip(ctx: ShellCtx, mode: Mode, current: boolean, changed: boolean): HTMLElement {
  const copied = mode.manifest.copiedFrom;
  return h(
    "button",
    {
      class: `mode-chip${current ? " is-current" : ""}`,
      type: "button",
      "data-key": `mode-${mode.manifest.id}`,
      "data-mode": mode.manifest.id,
      "aria-pressed": current ? "true" : "false",
      "aria-haspopup": current ? "menu" : undefined,
      "aria-expanded": current ? String(ctx.store.get().popover === "mode-menu") : undefined,
      "aria-label": copied
        ? `${mode.manifest.name} · ${ctx.tr("copiedFrom", { author: copied.author })}`
        : mode.manifest.name,
      onClick: () => {
        if (!current) return switchMode(ctx, mode.manifest.id);
        const open = ctx.store.get().popover === "mode-menu";
        ctx.store.set({ popover: open ? null : "mode-menu" });
      },
    },
    icon(mode.manifest.icon, 16),
    h("span", { class: "mode-name" }, mode.manifest.name),
    copied ? h("span", { class: "mode-copied" }, icon("copy", 12), copied.author) : null,
    current && changed
      ? h("span", { class: "dot dot-attention mode-dirty", title: ctx.tr("changed") })
      : null,
  );
}

function menu(ctx: ShellCtx, changed: boolean): HTMLElement {
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
  return h(
    "div",
    { class: "popover mode-menu", role: "menu", "aria-label": ctx.tr("modes") },
    item(ctx.tr("saveInto"), "menu-save", () => saveIntoMode(ctx), changed),
    item(ctx.tr("saveAsNew"), "menu-new", () =>
      ctx.store.set({ dialog: "new-mode", popover: null }),
    ),
    item(ctx.tr("revert"), "menu-revert", () => revert(ctx), changed),
  );
}

function dialog(ctx: ShellCtx): HTMLElement {
  const input = h("input", {
    class: "input",
    id: "new-mode-name",
    "data-key": "new-mode-name",
    autocomplete: "off",
    value: "",
  });
  const submit = (event: Event) => {
    event.preventDefault();
    if (input.value.trim()) saveAsNewMode(ctx, input.value);
  };
  const cancel = () => ctx.store.set({ dialog: null });
  const el = h(
    "div",
    { class: "scrim", onClick: (e: Event) => e.target === e.currentTarget && cancel() },
    h(
      "form",
      {
        class: "dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "new-mode-title",
        onSubmit: submit,
      },
      h("h2", { class: "dialog-title", id: "new-mode-title" }, ctx.tr("saveNowTitle")),
      h("p", { class: "dialog-hint" }, ctx.tr("saveNowHint")),
      h("label", { class: "field-label", for: "new-mode-name" }, ctx.tr("name")),
      input,
      h(
        "div",
        { class: "dialog-actions" },
        h("button", { class: "btn btn-ghost", type: "button", onClick: cancel }, ctx.tr("cancel")),
        h("button", { class: "btn btn-primary", type: "submit" }, ctx.tr("save")),
      ),
    ),
  );
  queueMicrotask(() => input.focus());
  return el;
}

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

  const draw = () => {
    const s = ctx.store.get();
    const changed = dirty(s);
    const current = modeOf(s);
    render(currentSlot, () => [chip(ctx, current, true, changed)]);
    render(others, () =>
      s.modes
        .filter((m) => m.manifest.id !== "base" && m.manifest.id !== current.manifest.id)
        .map((m) => chip(ctx, m, false, false)),
    );
    others.inert = !s.modesOpen;
    render(menuSlot, () => (s.popover === "mode-menu" ? [menu(ctx, changed)] : []));
  };
  let shown = 0;
  let animation = 0;
  const unfold = (open: boolean) => {
    const id = ++animation;
    const from = shown;
    const to = open ? 1 : 0;
    others.inert = !open;
    return ctx.ticker.animate(ctx.reduced() ? 0 : 400, easeOutExpo, (t) => {
      if (id !== animation) return;
      shown = from + (to - from) * t;
      others.style.maxWidth = `${Math.round(720 * shown)}px`;
      others.style.opacity = String(Math.round(shown * 1000) / 1000);
    });
  };
  others.style.maxWidth = "0px";
  others.style.opacity = "0";
  draw();
  const offs = [
    ctx.store.watch((s) => [s.modes, s.modeId, s.session, s.popover === "mode-menu", s.lang], draw),
    ctx.store.watch(
      (s) => s.modesOpen,
      (open) => void unfold(open),
    ),
    ctx.store.watch(
      (s) => s.dialog,
      (d) => render(dialogSlot, () => (d === "new-mode" ? [dialog(ctx)] : [])),
    ),
    listen(row, "pointerenter", () => ctx.store.set({ modesOpen: true })),
    listen(el, "pointerleave", () => {
      if (!el.contains(document.activeElement)) ctx.store.set({ modesOpen: false });
    }),
    listen(row, "focusin", () => ctx.store.set({ modesOpen: true })),
    listen(el, "focusout", (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (!next || !el.contains(next)) ctx.store.set({ modesOpen: false });
    }),
  ];
  return () => {
    for (const off of offs) off();
    el.remove();
    dialogSlot.remove();
  };
}
