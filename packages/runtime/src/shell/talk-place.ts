/**
 * Where the talk pill sits. By default it is centred on the bottom edge (bottom.css); a person can
 * drag it anywhere (`desk.shell.talk-place`), by the pill itself while it is folded and by its grip
 * while it is open. The place is the pill's bottom centre as shares of the app, so it follows the
 * app's size; the pill grows from there, kept inside the app with a margin, and its lists open
 * below it when it sits high up. A double-click on the grip, or `desk.shell.talk-home`, puts it back.
 */
import { appSize } from "../surface/coordinates";
import type { ShellCtx } from "./context";
import { listen } from "./dom";
import { draggable } from "./drag";

export const PLACE = "desk.shell.talk-place";
const HOME = "desk.shell.talk-home";
/** How close to the app's edges the pill may come. */
const MARGIN = 8;

/** The pill's bottom centre as shares of the app's width and height (0 to 1). */
export interface TalkPlace {
  x: number;
  y: number;
}

type State = "idle" | "hover" | "edit";

/** The pill's size in a state, as bottom.css draws it on an app `vw` wide. */
export function pillSize(state: State, vw: number): { w: number; h: number } {
  if (state === "edit") return { w: Math.min(640, vw - 280), h: 72 };
  return { w: state === "hover" ? 400 : 184, h: 48 };
}

/** A stored place, or null for the default (missing, malformed or out of range). */
export function placeOf(value: unknown): TalkPlace | null {
  const v = value as Partial<TalkPlace> | null | undefined;
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return v && ok(v.x) && ok(v.y) ? { x: v.x as number, y: v.y as number } : null;
}

/**
 * Where the pill is drawn for a place: its left edge and its distance from the app's bottom, in
 * pixels, kept inside the app; `high` when its top half sits in the app's top half.
 */
export function pillBox(place: TalkPlace, state: State, size: { vw: number; vh: number }) {
  const { w, h } = pillSize(state, size.vw);
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));
  const left = clamp(place.x * size.vw - w / 2, MARGIN, size.vw - w - MARGIN);
  const bottom = clamp(size.vh - place.y * size.vh, MARGIN, size.vh - h - MARGIN);
  return { left: Math.round(left), bottom: Math.round(bottom), w, h, high: bottom > size.vh / 2 };
}

/** The place a pill whose bottom centre is at (`cx`, `by`) in the app takes, kept inside it. */
export function placeAt(cx: number, by: number, size: { vw: number; vh: number }): TalkPlace {
  const share = (n: number, of: number) => Math.min(1, Math.max(0, of > 0 ? n / of : 0.5));
  return { x: share(cx, size.vw), y: share(by, size.vh) };
}

/** Presses that do something of their own: typing, the agent button, the lists. */
const OWN = "input, .talk-agent-button, .talk-agent-list, .composer-list";

/**
 * Make the pill movable. `state` reads the pill's state from its `data-state` (TalkChrome sets it);
 * call the returned `draw` whenever that changes.
 */
export function mountTalkPlace(el: HTMLElement, ctx: ShellCtx) {
  const { settings } = ctx.runtime;
  const grip = el.querySelector<HTMLElement>(".talk-grip");
  /** While dragging, the place under the pointer; it is stored on the drop. */
  let moving: TalkPlace | null = null;
  const state = () => (el.dataset.state as State | undefined) ?? "idle";
  const draw = () => {
    const place = moving ?? placeOf(settings.get(PLACE, null));
    el.classList.toggle("is-placed", place !== null);
    el.classList.toggle("is-moving", moving !== null);
    if (!place) {
      el.style.removeProperty("left");
      el.style.removeProperty("bottom");
      el.classList.remove("is-high");
      return;
    }
    const box = pillBox(place, state(), appSize());
    el.style.left = `${box.left}px`;
    el.style.bottom = `${box.bottom}px`;
    el.classList.toggle("is-high", box.high);
  };
  const home = () => {
    moving = null;
    settings.reset(PLACE);
    draw();
  };
  let from = { cx: 0, by: 0 };
  const offs = [
    draggable(el, {
      // Folded, the whole pill moves; open, only its grip does, so text and buttons work as before.
      accept: (e) => {
        const target = e.target as Element;
        if (target.closest(OWN)) return false;
        return state() !== "edit" || grip?.contains(target) === true;
      },
      start: () => {
        const r = el.getBoundingClientRect();
        const shell = (el.closest(".shell") ?? document.documentElement).getBoundingClientRect();
        from = { cx: r.left + r.width / 2 - shell.left, by: r.bottom - shell.top };
        moving = placeAt(from.cx, from.by, appSize());
        draw();
      },
      move: (dx, dy) => {
        moving = placeAt(from.cx + dx, from.by + dy, appSize());
        draw();
      },
      end: () => {
        const place = moving;
        moving = null;
        if (place) settings.set(PLACE, place);
        draw();
      },
      cancel: () => {
        moving = null;
        draw();
      },
    }),
    ctx.runtime.commands.define(HOME, {
      title: ctx.tr("cmdTalkHome"),
      owner: "desk.shell",
      keywords: ["talk", "eris", "move", "reset", "말하기", "제자리"],
      run: home,
    }),
    settings.onChange((keys) => {
      if (keys.includes(PLACE)) draw();
    }),
    listen(window, "resize", draw),
  ];
  // The drag captures the pointer on the pill, so the double-click arrives there: it counts on the grip.
  if (grip)
    offs.push(
      listen(el, "dblclick", (e) => {
        const { clientX: x, clientY: y } = e as MouseEvent;
        const r = grip.getBoundingClientRect();
        const onGrip = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        if (onGrip || grip.contains(e.target as Node)) home();
      }),
    );
  return {
    draw,
    dispose: () => {
      for (const off of offs) off();
      el.classList.remove("is-placed", "is-moving", "is-high");
      el.style.removeProperty("left");
      el.style.removeProperty("bottom");
    },
  };
}
