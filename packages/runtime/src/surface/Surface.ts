/**
 * Surfaces: windows on the desk. Card face, 1 px border, no shadow; Eris's own carry the lavender
 * border and a badge. Drag the title bar to move, the corner to resize; both save to the session layout.
 */

import type { SurfacePlacement } from "../modes/types";
import { closeSurface, stash, togglePin, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { panOf } from "../shell/Pan";
import { focusPane, splitPane, toggleFloating, toggleMaximize } from "../shell/windows";
import { isFloating, screenRect } from "./coordinates";
import { place, surfaceInteractions } from "./interactions";
import { renderPanes } from "./PaneView";
import { findLeaf, leaves, panesOf } from "./tree";
import { type Mounted, resolveView, viewOf } from "./views";

/** The pane whose view the title bar names: the focused one, else the first. */
function activeLeaf(ctx: ShellCtx, p: SurfacePlacement) {
  const s = ctx.store.get();
  const tree = panesOf(p);
  return (s.focused === p.id && s.pane ? findLeaf(tree, s.pane) : undefined) ?? leaves(tree)[0];
}

/** The view the title bar names, as the pane resolves it (a plugin's surface when it holds one). */
function activeView(ctx: ShellCtx, p: SurfacePlacement): string {
  return resolveView(ctx.store.get(), p, activeLeaf(ctx, p)?.view ?? p.id);
}

function tool(label: string, name: string, run: () => void, pressed?: boolean) {
  return h(
    "button",
    {
      class: "icon-button tool",
      type: "button",
      "aria-label": label,
      title: label,
      "aria-pressed": pressed === undefined ? undefined : String(pressed),
      onClick: (e: Event) => {
        e.stopPropagation();
        run();
      },
    },
    icon(name, 14),
  );
}

interface Entry {
  el: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  /** The placement as last drawn; the handlers read it, so a pin needs no rebuild. */
  placement: SurfacePlacement;
  /** Rebuild the whole surface when this changes (language). */
  key: string;
  /** Rebuild only the panes when this changes. */
  panesKey: string;
  panes: Mounted;
  /** Refresh the key hints in the tools' labels (the keymap changed) and the pin's state. */
  relabel: () => void;
  off: () => void;
}

export function mountSurfaces(root: HTMLElement, ctx: ShellCtx): () => void {
  const layer = h("div", { class: "surfaces" });
  root.append(layer);
  const live = new Map<string, Entry>();
  const size = () => ({
    vw: root.clientWidth || window.innerWidth,
    vh: root.clientHeight || window.innerHeight,
  });
  const hint = (label: string, command: string) => {
    const key = ctx.keyOf(command);
    return key ? `${label} (${key})` : label;
  };

  /** Title bar text for the active pane: icon, name, the view's own line and Eris's badge. */
  const drawTitle = (entry: Entry, p: SurfacePlacement) => {
    const view = viewOf(ctx, activeView(ctx, p));
    render(entry.title, () => [
      icon(view.icon, 16),
      h("span", { class: "surface-name" }, view.title),
      view.sub ? h("span", { class: "surface-sub" }, view.sub) : null,
      view.byEris ? h("span", { class: "eris-badge" }, ctx.tr("madeByEris")) : null,
    ]);
    entry.el.setAttribute("aria-label", view.title);
  };

  const build = (placed: SurfacePlacement): Entry => {
    const p = placed;
    const title = h("span", { class: "surface-heading" });
    const split = (dir: "row" | "column") => () => {
      focusPane(ctx, p.id, activeLeaf(ctx, p)?.id);
      splitPane(ctx, dir);
    };
    /** Close the window: a plugin's surface goes away for the session, a shell view's just closes. */
    const closeWindow = () => {
      const view = activeView(ctx, entry.placement);
      const all = leaves(panesOf(entry.placement));
      if (view.startsWith("plugin:") && all.length === 1) {
        ctx.runtime.plugins?.unmount(view.slice("plugin:".length));
      } else closeSurface(ctx, p.id);
    };
    const splitRight = tool(
      hint(ctx.tr("splitRight"), "desk.display.split-right"),
      "split-right",
      split("row"),
    );
    const splitDown = tool(
      hint(ctx.tr("splitDown"), "desk.display.split-down"),
      "split-down",
      split("column"),
    );
    const pinTool = tool(
      ctx.tr(p.pinned ? "unpin" : "pin"),
      "pin",
      () => togglePin(ctx, p.id),
      p.pinned,
    );
    const floatTool = tool(
      ctx.tr("floating"),
      "floating",
      () => toggleFloating(ctx, p.id, size()),
      isFloating(p),
    );
    const relabel = () => {
      floatTool.setAttribute("aria-pressed", String(isFloating(entry.placement)));
      for (const [button, label, command] of [
        [splitRight, ctx.tr("splitRight"), "desk.display.split-right"],
        [splitDown, ctx.tr("splitDown"), "desk.display.split-down"],
      ] as const) {
        button.setAttribute("aria-label", hint(label, command));
        button.title = hint(label, command);
      }
      const pinned = entry.placement.pinned;
      pinTool.setAttribute("aria-label", ctx.tr(pinned ? "unpin" : "pin"));
      pinTool.title = ctx.tr(pinned ? "unpin" : "pin");
      pinTool.setAttribute("aria-pressed", String(pinned));
    };
    const bar = h(
      "header",
      { class: "surface-title", title: ctx.tr("maximize") },
      title,
      h(
        "span",
        { class: "surface-tools" },
        splitRight,
        splitDown,
        floatTool,
        pinTool,
        tool(ctx.tr("stash"), "drawer", () =>
          stash(ctx, p.id, viewOf(ctx, activeView(ctx, entry.placement)).title),
        ),
        tool(ctx.tr("close"), "close", closeWindow),
      ),
    );
    const body = h("div", { class: "surface-body" });
    const el = h(
      "section",
      {
        class: `surface${p.pinned ? " is-pinned" : ""}`,
        "data-surface": p.id,
        role: "region",
        tabindex: "-1",
      },
      bar,
      body,
    );
    /** Focus follows the pointer or keyboard into a pane. */
    const focusFrom = (target: EventTarget | null) => {
      const pane = (target as Element | null)?.closest?.("[data-pane]")?.getAttribute("data-pane");
      const s = ctx.store.get();
      focusPane(ctx, p.id, pane ?? (s.focused === p.id ? (s.pane ?? undefined) : undefined));
    };
    const offs = [
      listen(el, "pointerdown", (e) => focusFrom(e.target)),
      listen(el, "focusin", (e) => focusFrom(e.target)),
      listen(bar, "dblclick", (e) => {
        if ((e.target as Element).closest("button")) return;
        toggleMaximize(ctx, p.id);
      }),
      surfaceInteractions(el, bar, () => entry.placement, size, ctx),
    ];
    const entry: Entry = {
      el,
      title,
      body,
      placement: p,
      key: "",
      panesKey: "",
      panes: { el: body },
      relabel,
      off: () => {
        for (const off of offs) off();
        entry.panes.off?.();
      },
    };
    return entry;
  };

  const draw = () => {
    const s = ctx.store.get();
    const { vw, vh } = size();
    const surfaces = windowsOf(s);
    const keep = new Set(surfaces.map((p) => p.id));
    for (const [id, entry] of live) {
      if (keep.has(id)) continue;
      entry.off();
      entry.el.remove();
      live.delete(id);
    }
    surfaces.forEach((p, i) => {
      // Only the language rebuilds a window: a rebuild would reload a plugin's frame inside it.
      const key = JSON.stringify([s.lang]);
      let entry = live.get(p.id);
      if (entry && entry.key !== key) {
        entry.off();
        entry.el.remove();
        entry = undefined;
      }
      if (!entry) {
        entry = build(p);
        entry.key = key;
        live.set(p.id, entry);
        layer.append(entry.el);
      }
      entry.placement = p;
      const all = leaves(panesOf(p));
      const views = all.map((l) => resolveView(s, p, l.view));
      const panesKey = JSON.stringify([panesOf(p), views]);
      if (entry.panesKey !== panesKey) {
        const activeSplit = entry.body.contains(document.activeElement)
          ? document.activeElement?.getAttribute("data-split")
          : null;
        entry.panes.off?.();
        entry.panes = renderPanes(ctx, p);
        entry.body.replaceChildren(entry.panes.el);
        entry.panesKey = panesKey;
        if (activeSplit) {
          entry.body
            .querySelector<HTMLElement>(`[data-split="${CSS.escape(activeSplit)}"]`)
            ?.focus();
        }
      }
      const active = s.focused === p.id ? activeLeaf(ctx, p)?.id : undefined;
      for (const pane of entry.body.querySelectorAll<HTMLElement>("[data-pane]")) {
        pane.classList.toggle("is-active", pane.dataset.pane === active && all.length > 1);
      }
      entry.el.classList.toggle(
        "is-eris",
        views.every((view) => viewOf(ctx, view).byEris),
      );
      entry.el.classList.toggle("is-pinned", p.pinned);
      entry.el.dataset.floating = String(isFloating(p));
      entry.relabel();
      drawTitle(entry, p);
      // Status/focus updates must not overwrite an in-progress pointer preview.
      if (!entry.el.classList.contains("is-dragging"))
        place(entry.el, screenRect(p, panOf(s), vw, vh));
      entry.el.style.zIndex = String(p.id === s.focused ? 100 : p.pinned ? 50 + i : 1 + i);
      entry.el.classList.toggle("is-focused", p.id === s.focused);
    });
  };
  draw();
  const offs = [
    ctx.store.watch(
      (s) => [
        windowsOf(s),
        s.adopted,
        s.focused,
        s.pane,
        s.lang,
        s.desktop,
        s.pan,
        s.agents,
        s.tasks,
        s.drawer,
      ],
      draw,
    ),
    // A new key only changes the tools' hints; rebuilding would remount every view.
    ctx.runtime.keymap.onChange(() => {
      for (const entry of live.values()) entry.relabel();
    }),
    listen(window, "resize", draw),
  ];
  return () => {
    for (const off of offs) off();
    for (const entry of live.values()) entry.off();
    layer.remove();
  };
}
