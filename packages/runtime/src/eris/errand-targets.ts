/**
 * Where Eris's errands go (ADR 0089, ADR 0271, ADR 0275): every window that shows the plugin a
 * command belongs to, found in the desk's page and in the windows' own pages (ADR 0201), each with
 * the window it lies in, whose frame glows meanwhile, and every other window the window manager
 * places with that plugin in it, whose page this one cannot read (the app's compositor draws each
 * window from a page of its own); for the desk's local agent tools a local agent's screen, else
 * their group in the agent bar.
 */
import type { BrainStep } from "../bridge/types";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import type { DeskState } from "../shell/state";
import { windowPlugins } from "../surface/placed";
import type { WindowDocs } from "../surface/window-docs";
import type { Point } from "./errand-thread";

/**
 * What an errand finds: the element it flies to and the window that lies in, if it is in one, or a
 * window alone, whose DOM is not in this page.
 */
export type Target = { el: HTMLElement; window?: string } | { el?: undefined; window: string };

/** What finding a window reads: the store and where each window's DOM lies. */
type Seen = Pick<ShellCtx, "store" | "pages">;

/**
 * The centre of `el` in `host`'s coordinates; an element in a window's own page (ADR 0201) is
 * measured in that page and lies at the window's place on the desk (`window-docs.ts`).
 */
export function centre(el: Element, host: HTMLElement, docs?: WindowDocs): Point {
  const r = el.getBoundingClientRect();
  const f = host.getBoundingClientRect();
  let at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const elsewhere = el.ownerDocument !== host.ownerDocument;
  const page = elsewhere ? docs?.windowOf(el.ownerDocument) : undefined;
  if (page && docs) at = docs.toDesk(page, at);
  return { x: at.x - f.left, y: at.y - f.top };
}

/**
 * The plugin's surfaces on screen, its main one and its others; in `host`, then in the windows' own
 * pages (ADR 0201).
 */
export function surfacesOf(host: ParentNode, provider: string, docs?: WindowDocs): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const root of [host, ...(docs?.each() ?? []).map(([, doc]) => doc)]) {
    for (const el of root.querySelectorAll<HTMLElement>("[data-surface]")) {
      const id = el.dataset.surface ?? "";
      const own = id === provider || id.startsWith(`${provider}/`) || id.startsWith(`${provider}:`);
      const shown = !el.hidden && el.getClientRects().length > 0;
      if (own && shown) found.push(el);
    }
  }
  return found;
}

/** The plugin's window on screen: the first of its surfaces there. */
export function windowOf(
  host: ParentNode,
  provider: string,
  docs?: WindowDocs,
): HTMLElement | null {
  return surfacesOf(host, provider, docs)[0] ?? null;
}

/** The desk's commands for the agent programs on this computer (ADR 0110). */
const LOCAL_AGENTS = "desk.agents.";

/**
 * Where a step's errand goes first: the plugin's window, or for the desk's local agent tools a
 * local agent's screen, else their group in the agent bar.
 */
export function targetOf(
  host: ParentNode,
  step: Pick<BrainStep, "provider" | "command">,
  docs?: WindowDocs,
) {
  if (!step.command.startsWith(LOCAL_AGENTS)) return windowOf(host, step.provider, docs);
  const screen = windowOf(host, "local", docs);
  if (screen) return screen;
  const group = host.querySelector<HTMLElement>("[data-local-agents]");
  return group && group.getClientRects().length > 0 ? group : null;
}

/**
 * The window `el` lies in: the one whose own page it is in, the section around it, the window its
 * place is kept for (a plugin's section stays in the desk's page, in its window's group, while the
 * window lies in a page of its own, `surface/anchors.ts`), or the window of the desktop in front
 * that shows the plugin surface it is.
 */
export function windowIdOf(el: HTMLElement, ctx: Seen): string | undefined {
  const paged = ctx.pages?.windowOf(el.ownerDocument);
  if (paged) return paged;
  const section = el.closest<HTMLElement>(".surface[data-surface]");
  if (section?.dataset.surface) return section.dataset.surface;
  const kept = el.closest<HTMLElement>(".surface-anchor[data-window]");
  if (kept?.dataset.window) return kept.dataset.window;
  const s = ctx.store.get();
  const surface = el.dataset.surface ?? "";
  return windowsOf(s).find((w) => windowPlugins(s, w.id).includes(surface))?.id;
}

/**
 * Everywhere a step's errand goes: each window that shows the plugin once (several of its surfaces
 * may lie in one), or the one place `targetOf` names for the local agent tools.
 */
export function targetsOf(
  host: ParentNode,
  step: Pick<BrainStep, "provider" | "command">,
  ctx: Seen,
): Target[] {
  const local = step.command.startsWith(LOCAL_AGENTS);
  const first = local ? targetOf(host, step, ctx.pages) : null;
  const els = local ? (first ? [first] : []) : surfacesOf(host, step.provider, ctx.pages);
  const targets: Target[] = [];
  for (const el of els) {
    const window = windowIdOf(el, ctx);
    if (window && targets.some((t) => t.window === window)) continue;
    targets.push(window ? { el, window } : { el });
  }
  if (local) return targets;
  for (const window of windowsShowing(ctx.store.get(), step.provider)) {
    if (!targets.some((t) => t.window === window)) targets.push({ window });
  }
  return targets;
}

/** The windows of the desktop in front that the window manager places with `provider`'s surfaces. */
export function windowsShowing(s: DeskState, provider: string): string[] {
  const own = (id: string) =>
    id === provider || id.startsWith(`${provider}/`) || id.startsWith(`${provider}:`);
  return windowsOf(s)
    .filter((w) => windowPlugins(s, w.id).some(own))
    .map((w) => w.id);
}

/** A box in `host`'s coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The box of `el` in `host`'s coordinates; an element in a window's own page (ADR 0201) is measured
 * in that page and lies at the window's place on the desk (`window-docs.ts`).
 */
export function boxOf(el: Element, host: HTMLElement, docs?: WindowDocs): Box {
  const r = el.getBoundingClientRect();
  const f = host.getBoundingClientRect();
  let a = { x: r.left, y: r.top };
  let b = { x: r.left + r.width, y: r.top + r.height };
  const page =
    el.ownerDocument !== host.ownerDocument ? docs?.windowOf(el.ownerDocument) : undefined;
  if (page && docs) [a, b] = [docs.toDesk(page, a), docs.toDesk(page, b)];
  return { x: a.x - f.left, y: a.y - f.top, w: b.x - a.x, h: b.y - a.y };
}

/**
 * Window `id`'s box in `host`'s coordinates, where it is now: of its section where its DOM lies,
 * else of where the desk draws it (held by a gesture, or as the window manager placed it, the
 * canvas's pan in it). Read again on every frame, it follows the window and the desk's pan.
 */
export function windowBox(
  host: HTMLElement,
  id: string,
  ctx: Seen & Partial<Pick<ShellCtx, "held">>,
): Box | undefined {
  const section =
    ctx.pages?.section(id, host) ??
    [...host.querySelectorAll<HTMLElement>(".surface[data-surface]")].find(
      (el) => el.dataset.surface === id,
    );
  if (section && section.getClientRects().length > 0) return boxOf(section, host, ctx.pages);
  const rect = ctx.held?.rect(id) ?? ctx.store.get().wm.front.find((w) => w.id === id)?.rect;
  if (!rect) return undefined;
  const f = host.getBoundingClientRect();
  return { x: rect.x - f.left, y: rect.y - f.top, w: rect.w, h: rect.h };
}

/**
 * Where the way from `box`'s middle toward `toward` crosses its edge: the point of its border that
 * faces `toward`. From inside the box, the nearest point of its edge.
 */
export function borderPoint(box: Box, toward: Point): Point {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = box.w / 2;
  const hh = box.h / 2;
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) {
    const gaps = [
      toward.x - box.x,
      box.x + box.w - toward.x,
      toward.y - box.y,
      box.y + box.h - toward.y,
    ];
    const near = gaps.indexOf(Math.min(...gaps));
    if (near === 0) return { x: box.x, y: toward.y };
    if (near === 1) return { x: box.x + box.w, y: toward.y };
    if (near === 2) return { x: toward.x, y: box.y };
    return { x: toward.x, y: box.y + box.h };
  }
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/**
 * Where on `target`'s border an errand's thread meets it: the point that faces Eris, read again on
 * every call, so it follows the window as it moves, the desk as it pans and her as she moves. A
 * window gone from the screen keeps its last place. Undefined when the target is nowhere on screen.
 */
export function edgeOf(
  host: HTMLElement,
  { el, window }: Target,
  ctx: Seen & Partial<Pick<ShellCtx, "held">>,
): (() => Point) | undefined {
  const now = () =>
    (window ? windowBox(host, window, ctx) : undefined) ??
    (el?.isConnected && el.getClientRects().length > 0 ? boxOf(el, host, ctx.pages) : undefined);
  let last = now();
  if (!last) return undefined;
  return () => {
    last = now() ?? last;
    return borderPoint(last as Box, erisAt(host));
  };
}

/** Who a step goes to, as people read it: `endue.mail` is Mail, the local agent tools Agents. */
export function labelOf(step: Pick<BrainStep, "provider" | "command">): string {
  return step.command.startsWith(LOCAL_AGENTS) ? "Agents" : nameOf(step.provider);
}

/** The plugin's name as people read it: `endue.mail` is Mail, `desk` is Desk. */
export function nameOf(provider: string): string {
  const last = provider.split(".").pop() ?? provider;
  return last
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Where Eris is: her body's centre, else the top middle of the desk. */
export function erisAt(host: HTMLElement): Point {
  const eris = host.querySelector(".eris-body") ?? host.querySelector(".eris");
  if (eris) return centre(eris, host);
  return { x: host.clientWidth / 2, y: 100 };
}
