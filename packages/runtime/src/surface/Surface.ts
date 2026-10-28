/**
 * Surfaces: windows on the desk. Card face, 1 px border, no shadow; Eris's own carry the lavender
 * border and a badge. Drag the title bar to move, the corner to resize; both save to the session layout.
 */
import type { SurfacePlacement } from "../modes/types";
import {
  closeSurface,
  focusSurface,
  layoutOf,
  moveSurface,
  stash,
  togglePin,
} from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { draggable } from "../shell/drag";
import { icon } from "../shell/icons";
import { clampRect, fromScreen, type Rect, toScreen } from "./geometry";
import { calendarBody } from "./samples/calendar";
import { notesBody } from "./samples/notes";
import { tomorrowBody } from "./samples/tomorrow";

interface Content {
  icon: string;
  title: string;
  sub: string;
  byEris: boolean;
  body: () => HTMLElement;
}

function contentOf(ctx: ShellCtx, id: string): Content {
  const s = ctx.store.get();
  if (id === "calendar")
    return {
      icon: "calendar",
      title: ctx.tr("surfaceCalendar"),
      sub: ctx.tr("thisWeek"),
      byEris: false,
      body: () => calendarBody(ctx),
    };
  if (id === "tomorrow")
    return {
      icon: "list",
      title: ctx.tr("surfaceTomorrow"),
      sub: ctx.tr("forTomorrow"),
      byEris: true,
      body: () => tomorrowBody(ctx),
    };
  if (id === "notes")
    return {
      icon: "note",
      title: ctx.tr("surfaceNotes"),
      sub: ctx.tr("notesHint"),
      byEris: false,
      body: () => notesBody(ctx),
    };
  if (id.startsWith("agent:")) {
    const agent = s.spaces.flatMap((sp) => sp.agents).find((a) => `agent:${a.id}` === id);
    const name = agent?.name ?? id.slice(6);
    const task = s.tasks.find((t) => t.agent === agent?.id);
    return {
      icon: "user",
      title: ctx.tr("agentScreen", { name }),
      sub: task?.title ?? "",
      byEris: false,
      body: () =>
        h("div", { class: "list-body" }, h("p", { class: "list-row" }, task?.title ?? name)),
    };
  }
  const name = id.replace(/^(file|recent):/, "");
  const item = s.drawer.find((d) => d.id === name);
  return {
    icon: id.startsWith("recent:") ? "sparkle" : "file",
    title: item?.name ?? name.replace(/^recent-/, ""),
    sub: id.startsWith("recent:") ? ctx.tr("recent") : ctx.tr("file"),
    byEris: id.startsWith("recent:"),
    body: () => h("div", { class: "list-body" }, h("p", { class: "list-row" }, name)),
  };
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

export function mountSurfaces(root: HTMLElement, ctx: ShellCtx): () => void {
  const layer = h("div", { class: "surfaces" });
  root.append(layer);
  const live = new Map<string, { el: HTMLElement; off: () => void; key: string }>();
  const size = () => ({
    vw: root.clientWidth || window.innerWidth,
    vh: root.clientHeight || window.innerHeight,
  });

  const place = (el: HTMLElement, r: Rect) => {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  const build = (p: SurfacePlacement) => {
    const c = contentOf(ctx, p.id);
    const title = h(
      "header",
      { class: "surface-title" },
      icon(c.icon, 16),
      h("span", { class: "surface-name" }, c.title),
      c.sub ? h("span", { class: "surface-sub" }, c.sub) : null,
      c.byEris ? h("span", { class: "eris-badge" }, ctx.tr("madeByEris")) : null,
      h(
        "span",
        { class: "surface-tools" },
        tool(ctx.tr(p.pinned ? "unpin" : "pin"), "pin", () => togglePin(ctx, p.id), p.pinned),
        tool(ctx.tr("stash"), "drawer", () => stash(ctx, p.id)),
        tool(ctx.tr("close"), "close", () => closeSurface(ctx, p.id)),
      ),
    );
    const grip = h("span", {
      class: "surface-resize",
      "aria-hidden": "true",
      title: ctx.tr("resize"),
    });
    const el = h(
      "section",
      {
        class: `surface${c.byEris ? " is-eris" : ""}${p.pinned ? " is-pinned" : ""}`,
        "data-surface": p.id,
        role: "region",
        "aria-label": c.title,
        tabindex: "-1",
      },
      title,
      h("div", { class: "surface-body" }, c.body()),
      grip,
    );
    let start: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const begin = () => {
      start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      el.classList.add("is-dragging");
    };
    const commit = (r: Rect) => {
      el.classList.remove("is-dragging");
      const { vw, vh } = size();
      moveSurface(ctx, p.id, fromScreen(r, vw, vh));
    };
    const offs = [
      listen(el, "pointerdown", () => focusSurface(ctx, p.id)),
      listen(el, "focusin", () => focusSurface(ctx, p.id)),
      draggable(title, {
        accept: (e) => !(e.target as Element).closest("button") && !p.pinned,
        start: begin,
        move: (dx, dy) => {
          const { vw, vh } = size();
          place(el, clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh));
        },
        end: (dx, dy) => {
          const { vw, vh } = size();
          commit(clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh));
        },
      }),
      draggable(grip, {
        start: begin,
        move: (dx, dy) => {
          const { vw, vh } = size();
          place(el, clampRect({ ...start, w: start.w + dx, h: start.h + dy }, vw, vh));
        },
        end: (dx, dy) => {
          const { vw, vh } = size();
          commit(clampRect({ ...start, w: start.w + dx, h: start.h + dy }, vw, vh));
        },
      }),
    ];
    return {
      el,
      off: () => {
        for (const off of offs) off();
      },
    };
  };

  const draw = () => {
    const s = ctx.store.get();
    const { vw, vh } = size();
    const surfaces = layoutOf(s).surfaces;
    const keep = new Set(surfaces.map((p) => p.id));
    for (const [id, entry] of live) {
      if (keep.has(id)) continue;
      entry.off();
      entry.el.remove();
      live.delete(id);
    }
    surfaces.forEach((p, i) => {
      const key = JSON.stringify([p.pinned, s.lang]);
      let entry = live.get(p.id);
      if (entry && entry.key !== key) {
        entry.off();
        entry.el.remove();
        entry = undefined;
      }
      if (!entry) {
        entry = { ...build(p), key };
        live.set(p.id, entry);
        layer.append(entry.el);
      }
      place(entry.el, toScreen(p, vw, vh));
      entry.el.style.zIndex = String(p.id === s.focused ? 100 : p.pinned ? 50 + i : 1 + i);
      entry.el.classList.toggle("is-focused", p.id === s.focused);
    });
  };
  draw();
  const offs = [
    ctx.store.watch((s) => [layoutOf(s), s.focused, s.lang, s.desktop], draw),
    listen(window, "resize", draw),
  ];
  return () => {
    for (const off of offs) off();
    for (const entry of live.values()) entry.off();
    layer.remove();
  };
}
