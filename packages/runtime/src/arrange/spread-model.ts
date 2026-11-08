/**
 * The spread without the DOM (ADR 0116): which window takes which place in the fan, the filter,
 * the selection and how the keys move it, the camera the person pans and zooms, and the pose each
 * window is drawn at. Windows keep their spatial order: rows from the top of the desk down, each
 * from left to right, so a tiled desk spreads in the order it reads.
 */
import type { Rect } from "../surface/geometry";
import { fanRows, gridShape, rowSizes, type Slot, spreadSlots, spreadStage } from "./geometry";

export interface SpreadWindow {
  id: string;
  title: string;
  /** Where it is drawn now, in app pixels. */
  rect: Rect;
  /** Covered or unloaded (ADR 0070): a placeholder stands in for its content. */
  asleep: boolean;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** A window's transform in the spread, about its own centre. */
export interface Pose {
  tx: number;
  ty: number;
  z: number;
  rotateY: number;
  rotateX: number;
  scale: number;
  opacity: number;
}

export const IDENTITY: Pose = { tx: 0, ty: 0, z: 0, rotateY: 0, rotateX: 0, scale: 1, opacity: 1 };
export const ZOOM = { min: 0.5, max: 2.5 };

export type Move = "left" | "right" | "up" | "down" | "next" | "previous" | "first" | "last";
export type SpreadAction =
  | { kind: "choose"; id: string }
  | { kind: "cancel" }
  | { kind: "moved" }
  | { kind: "none" };

/** Lower-cased and composed, so typed Korean and wide letters match titles. */
const fold = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** `windows` in the spread's order for row sizes `rows`: by height into rows, then left to right. */
export function spreadOrder<T extends { rect: Rect }>(windows: T[], rows: number[]): T[] {
  const byY = [...windows].sort((a, b) => centre(a.rect).y - centre(b.rect).y);
  const out: T[] = [];
  let at = 0;
  for (const k of rows) {
    const row = byY.slice(at, at + k).sort((a, b) => centre(a.rect).x - centre(b.rect).x);
    out.push(...row);
    at += k;
  }
  return out;
}

export class SpreadModel {
  readonly #view: { vw: number; vh: number };
  readonly #flat: boolean;
  #windows: SpreadWindow[] = [];
  #filter = "";
  #selected: string | null = null;
  #camera: Camera = { x: 0, y: 0, zoom: 1 };
  /** Every window's place with no filter, and the shown ones' places with it. */
  #all = new Map<string, Slot>();
  #shown: SpreadWindow[] = [];
  #slots = new Map<string, Slot>();

  constructor(
    windows: SpreadWindow[],
    view: { vw: number; vh: number },
    options: { flat?: boolean; selected?: string | null } = {},
  ) {
    this.#view = view;
    this.#flat = options.flat === true;
    this.update(windows);
    const first = options.selected ?? null;
    this.#selected = this.#slots.has(first ?? "") ? first : (this.#shown[0]?.id ?? null);
  }

  get flat(): boolean {
    return this.#flat;
  }

  get filter(): string {
    return this.#filter;
  }

  get selected(): string | null {
    return this.#selected;
  }

  get camera(): Camera {
    return { ...this.#camera };
  }

  /** Every window, in the order given. */
  windows(): SpreadWindow[] {
    return [...this.#windows];
  }

  /** The windows the filter lets through, in the spread's order: what the keys walk through. */
  shown(): SpreadWindow[] {
    return [...this.#shown];
  }

  slotOf(id: string): Slot | undefined {
    return this.#slots.get(id) ?? this.#all.get(id);
  }

  /** New windows or new places (the desk changed under the spread); filter and selection stay. */
  update(windows: SpreadWindow[]): void {
    this.#windows = windows.map((w) => ({ ...w, rect: { ...w.rect } }));
    this.#all = this.#layout(this.#windows).slots;
    this.#refilter();
  }

  /** Keep the windows whose title holds `text`; the selection stays when it still shows. */
  setFilter(text: string): void {
    this.#filter = text;
    this.#refilter();
  }

  select(id: string): boolean {
    if (!this.#slots.has(id) || this.#selected === id) return false;
    this.#selected = id;
    return true;
  }

  /** Move the selection: along a row (on to the next row at its end), between rows, or in order. */
  move(move: Move): boolean {
    const order = this.#shown;
    if (order.length === 0) return false;
    const at = order.findIndex((w) => w.id === this.#selected);
    const step = (by: number) => order[(Math.max(0, at) + by + order.length) % order.length];
    let next: SpreadWindow | undefined;
    if (at < 0 || move === "first") next = order[0];
    else if (move === "last") next = order.at(-1);
    else if (move === "next" || move === "right") next = step(1);
    else if (move === "previous" || move === "left") next = step(-1);
    else next = this.#vertical(order[at]?.id ?? "", move === "up" ? -1 : 1);
    return next ? this.select(next.id) || at < 0 : false;
  }

  /** What a key does: arrows, Tab, Home and End move; Enter chooses; Escape cancels. */
  key(e: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): SpreadAction {
    if (e.key === "Escape") return { kind: "cancel" };
    if (e.key === "Enter") return this.#selected ? { kind: "choose", id: this.#selected } : NONE;
    if (e.metaKey || e.ctrlKey) return NONE;
    const moves: Record<string, Move> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      Home: "first",
      End: "last",
    };
    const move = e.key === "Tab" ? (e.shiftKey ? "previous" : "next") : moves[e.key];
    if (!move) return NONE;
    this.move(move);
    this.keepInView();
    return { kind: "moved" };
  }

  pan(dx: number, dy: number): void {
    this.#camera = { ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy };
  }

  /** Zoom by `factor` about the point `(x, y)` on screen, which stays where it is. */
  zoomAt(factor: number, x: number, y: number): void {
    const { zoom } = this.#camera;
    const next = Math.min(ZOOM.max, Math.max(ZOOM.min, zoom * factor));
    const k = next / zoom;
    const cx = this.#view.vw / 2;
    const cy = this.#view.vh / 2;
    // The point's offset from the centre, less the pan, scales with the zoom.
    this.#camera = {
      zoom: next,
      x: x - cx - (x - cx - this.#camera.x) * k,
      y: y - cy - (y - cy - this.#camera.y) * k,
    };
  }

  /** Pan just enough to bring the selected card wholly into sight. */
  keepInView(): void {
    const slot = this.#selected ? this.#slots.get(this.#selected) : undefined;
    if (!slot) return;
    const r = this.#onScreen(slot);
    const margin = 24;
    const dx =
      r.x < margin
        ? margin - r.x
        : r.x + r.w > this.#view.vw - margin
          ? this.#view.vw - margin - r.x - r.w
          : 0;
    const dy =
      r.y < margin
        ? margin - r.y
        : r.y + r.h > this.#view.vh - margin
          ? this.#view.vh - margin - r.y - r.h
          : 0;
    if (dx || dy) this.pan(dx, dy);
  }

  /** The pose of every window: the shown ones in their places, the others faded where they were. */
  poses(): Map<string, Pose> {
    return new Map(this.#windows.map((w) => [w.id, this.poseOf(w)]));
  }

  poseOf(w: SpreadWindow): Pose {
    const shown = this.#slots.has(w.id);
    const slot = this.#slots.get(w.id) ?? this.#all.get(w.id);
    if (!slot) return { ...IDENTITY, opacity: 0 };
    const r = this.#onScreen(slot);
    const fit = Math.min(slot.w / w.rect.w, slot.h / w.rect.h, 1) * this.#camera.zoom;
    const lifted = shown && w.id === this.#selected;
    const c = centre(w.rect);
    return {
      tx: round(r.x + r.w / 2 - c.x),
      ty: round(r.y + r.h / 2 - c.y),
      z: round(slot.z * this.#camera.zoom + (lifted && !this.#flat ? 56 : 0) - (shown ? 0 : 160)),
      rotateY: slot.rotateY,
      rotateX: slot.rotateX,
      scale: round(fit * (lifted ? 1.04 : 1) * (shown ? 1 : 0.85), 4),
      opacity: shown ? 1 : 0,
    };
  }

  /** Paint order: the slot's, the selected card above every other. */
  orderOf(id: string): number {
    const slot = this.slotOf(id);
    return (slot?.order ?? 0) + (id === this.#selected ? 1000 : 0);
  }

  #refilter(): void {
    const q = fold(this.#filter.trim());
    const shown = q ? this.#windows.filter((w) => fold(w.title).includes(q)) : this.#windows;
    const { order, slots } = this.#layout(shown);
    this.#shown = order;
    this.#slots = slots;
    if (!this.#selected || !slots.has(this.#selected)) this.#selected = order[0]?.id ?? null;
  }

  #layout(windows: SpreadWindow[]) {
    const stage = spreadStage(this.#view.vw, this.#view.vh);
    const rows = this.#flat
      ? rowSizes(windows.length, gridShape(windows.length, stage, 24).cols)
      : fanRows(windows.length, stage);
    const order = spreadOrder(windows, rows);
    const places = spreadSlots(order.length, stage, this.#flat);
    const slots = new Map<string, Slot>();
    order.forEach((w, i) => {
      const slot = places[i];
      if (slot) slots.set(w.id, slot);
    });
    return { order, slots };
  }

  /** The nearest card in the row above (-1) or below (+1) the one with `id`. */
  #vertical(id: string, by: -1 | 1): SpreadWindow | undefined {
    const from = this.#slots.get(id);
    if (!from) return;
    const row = this.#shown.filter((w) => this.#slots.get(w.id)?.row === from.row + by);
    const x = from.x + from.w / 2;
    let best: SpreadWindow | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const w of row) {
      const s = this.#slots.get(w.id);
      const d = s ? Math.abs(s.x + s.w / 2 - x) : Number.POSITIVE_INFINITY;
      if (d < distance) {
        best = w;
        distance = d;
      }
    }
    return best;
  }

  /** A slot's box on screen through the camera (before perspective). */
  #onScreen(slot: Slot): Rect {
    const { x, y, zoom } = this.#camera;
    const cx = this.#view.vw / 2;
    const cy = this.#view.vh / 2;
    return {
      x: cx + (slot.x - cx) * zoom + x,
      y: cy + (slot.y - cy) * zoom + y,
      w: slot.w * zoom,
      h: slot.h * zoom,
    };
  }
}

const NONE: SpreadAction = { kind: "none" };

/** Between two poses, `t` from 0 to 1. */
export function mix(a: Pose, b: Pose, t: number): Pose {
  const at = (key: keyof Pose) => a[key] + (b[key] - a[key]) * t;
  return {
    tx: at("tx"),
    ty: at("ty"),
    z: at("z"),
    rotateY: at("rotateY"),
    rotateX: at("rotateX"),
    scale: at("scale"),
    opacity: at("opacity"),
  };
}

/** A pose as a CSS transform about the window's centre. */
export function transformOf(p: Pose): string {
  const n = (v: number, digits = 2) => String(round(v, digits));
  return `translate3d(${n(p.tx)}px, ${n(p.ty)}px, ${n(p.z)}px) rotateY(${n(p.rotateY)}deg) rotateX(${n(p.rotateX)}deg) scale(${n(p.scale, 4)})`;
}

function round(v: number, digits = 2): number {
  const k = 10 ** digits;
  const r = Math.round(v * k) / k;
  return r === 0 ? 0 : r;
}
