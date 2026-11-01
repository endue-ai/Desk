/** Bottom left: the drawer. Put-away surfaces, dropped files, and Eris's temporary screens ("recent"). */
import { layoutOf, raise } from "./actions";
import type { ShellCtx } from "./context";
import { h, render } from "./dom";
import { icon } from "./icons";
import type { DrawerItem } from "./state";

const HOUR = 3_600_000;

/** Recent items start fading after 12 h and leave after 24 h. */
export function recentFade(age: number): number {
  return Math.max(0, Math.min(1, 1 - (age - 12 * HOUR) / (12 * HOUR)));
}

function thumbIcon(item: DrawerItem): string {
  if (item.kind === "file") return "file";
  if (item.kind === "recent") return "sparkle";
  const id = item.placement?.id ?? "";
  return id === "calendar" ? "calendar" : id === "notes" ? "note" : "list";
}

export function mountDrawer(root: HTMLElement, ctx: ShellCtx): () => void {
  const button = h("button", {
    class: "icon-button drawer-button",
    type: "button",
    "data-key": "drawer",
  });
  const panel = h("div", { class: "drawer-slot" });
  const el = h("div", { class: "drawer" }, panel, button);
  root.append(el);

  const visible = () => {
    const now = ctx.wall();
    return ctx.store.get().drawer.filter((d) => d.kind !== "recent" || now - d.at < 24 * HOUR);
  };
  const entry = (item: DrawerItem) => {
    const age = ctx.wall() - item.at;
    const hours = Math.floor(age / HOUR);
    return h(
      "li",
      { class: "drawer-item", "data-item": item.id },
      h(
        "span",
        {
          class: `thumb thumb-${item.kind}`,
          "aria-hidden": "true",
          style: item.kind === "recent" ? { opacity: recentFade(age).toFixed(2) } : {},
        },
        icon(thumbIcon(item), 16),
      ),
      h(
        "span",
        { class: "drawer-name" },
        item.name,
        h(
          "span",
          { class: "drawer-meta" },
          hours >= 1 ? ctx.tr("hoursAgo", { n: hours }) : ctx.tr("justNow"),
        ),
      ),
      h(
        "button",
        {
          class: "btn btn-outline btn-xs",
          type: "button",
          "data-key": `raise-${item.id}`,
          onClick: () => raise(ctx, item.id),
        },
        ctx.tr("raise"),
      ),
    );
  };
  const draw = () => {
    const s = ctx.store.get();
    el.hidden = !layoutOf(s).drawer.visible;
    const items = visible();
    const label = ctx.tr("drawer", { n: items.length });
    render(button, () => [
      icon("drawer", 20),
      items.length ? h("span", { class: "badge" }, items.length) : null,
    ]);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("aria-expanded", String(s.popover === "drawer"));
    button.onclick = () => ctx.store.set({ popover: s.popover === "drawer" ? null : "drawer" });
    const kept = items.filter((i) => i.kind !== "recent");
    const recent = items.filter((i) => i.kind === "recent");
    render(panel, () =>
      s.popover === "drawer"
        ? [
            h(
              "div",
              {
                class: "popover drawer-panel",
                role: "dialog",
                "aria-label": ctx.tr("drawerTitle"),
              },
              h("div", { class: "pop-title" }, ctx.tr("drawerTitle")),
              kept.length || recent.length ? null : h("p", { class: "pop-muted" }, ctx.tr("empty")),
              kept.length ? h("ul", { class: "drawer-list" }, kept.map(entry)) : null,
              recent.length ? h("div", { class: "drawer-section" }, ctx.tr("recent")) : null,
              recent.length ? h("ul", { class: "drawer-list" }, recent.map(entry)) : null,
            ),
          ]
        : [],
    );
  };
  draw();
  const off = ctx.store.watch(
    (s) => [s.drawer, s.popover === "drawer", s.lang, layoutOf(s).drawer],
    draw,
  );
  return () => {
    off();
    el.remove();
  };
}
