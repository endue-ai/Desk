// The person's pointer and keys on the desk, as WebDriver actions in the desk's viewport (CSS
// pixels), for the windows-* specs (#82). Points come from desk.windows.list's rects and the
// chrome's metrics below, never from the page. On the compositor's desk (`DESK_COMPOSITOR=1`)
// drags, their release and Escape go through the compositor's own input instead
// (`compositor_input`, support/compositor.ts), where desk-wm moves, resizes, snaps and pans the
// windows (#80, ADR 0153); the composed frames are the screen. A drag can be held (`hold`) so a
// spec looks at the desk mid-drag, then `release`d. Keys go as their own action so a held button
// stays down (browser.keys would release it). The desk keeps drawing while they run (frames.ts),
// or a locked screen would hold each move for seconds.
import { browser } from "@wdio/globals";
import { feed } from "./compositor";
import { composited } from "./desk";
import { drawing, filming } from "./frames";
import { composedFrame } from "./pixels";
import { type Desk, onScreen, type Rect, rectOf } from "./windows";

export type Point = { x: number; y: number };

/** WebDriver's key codes for the keys the specs press. */
export const KEY = {
  shift: "",
  control: "",
  alt: "",
  meta: "",
  escape: "",
  tab: "",
  enter: "",
  left: "",
  right: "",
} as const;

/** The desk's Mod: Command on macOS, Control elsewhere (input.ts). */
export const MOD = process.platform === "darwin" ? KEY.meta : KEY.control;

/**
 * Where the shell draws a window's chrome today (`surface/Surface.ts`, `surface.css`): a 40 px title
 * bar, its six tools 24 px wide every 26 px from 21 px inside the right edge, and the resize grips
 * along the edges (6 px) and in the corners (16 px). The compositor's chrome keeps them (#81).
 */
export const TITLE_BAR = 40;
const TOOLS = ["close", "drawer", "pin", "floating", "split-down", "split-right"] as const;
export type Tool = (typeof TOOLS)[number];
export type Grip = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** A point on a window's title bar, `dx` from its left edge (past its icon by default). */
export const titleAt = (w: Rect, dx = 80): Point => ({ x: w.x + dx, y: w.y + TITLE_BAR / 2 });

/** The middle of one of a window's title bar tools. */
export const toolAt = (w: Rect, tool: Tool): Point => ({
  x: w.x + w.w - 21 - 26 * TOOLS.indexOf(tool),
  y: w.y + TITLE_BAR / 2,
});

/** The middle of one of a window's resize grips. */
export function gripAt(w: Rect, grip: Grip): Point {
  const x = grip.includes("w") ? w.x + 9 : grip.includes("e") ? w.x + w.w - 9 : w.x + w.w / 2;
  const y = grip.includes("n") ? w.y + 9 : grip.includes("s") ? w.y + w.h - 9 : w.y + w.h / 2;
  // An edge's grip is 6 px thick at the very edge.
  if (grip === "e") return { x: w.x + w.w - 4, y };
  if (grip === "w") return { x: w.x + 4, y };
  if (grip === "n") return { x, y: w.y + 4 };
  if (grip === "s") return { x, y: w.y + w.h - 4 };
  return { x, y };
}

/** The drawer's button, bottom left of the desk (`shell/Drawer.ts`): it opens the drawer's list. */
export const drawerButtonAt = (screen: { w: number; h: number }): Point => ({
  x: 112,
  y: screen.h - 40,
});

/** The middle of a window's body, under its title bar. */
export const bodyAt = (w: Rect): Point => ({
  x: w.x + w.w / 2,
  y: w.y + TITLE_BAR + (w.h - TITLE_BAR) / 2,
});

type PointerAction =
  | { type: "pointerMove"; x: number; y: number; duration: number; origin: "viewport" }
  | { type: "pointerDown" | "pointerUp"; button: number }
  | { type: "pause"; duration: number };
type KeyAction = { type: "keyDown" | "keyUp"; value: string } | { type: "pause"; duration: number };

const at = (p: Point, duration = 0): PointerAction => ({
  type: "pointerMove",
  x: Math.round(p.x),
  y: Math.round(p.y),
  duration,
  origin: "viewport",
});

/** Run pointer actions, with keys held down around them when `held` names some. */
async function perform(pointer: PointerAction[], held: string[] = []): Promise<void> {
  const sequences: object[] = [
    { type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: pointer },
  ];
  if (held.length) {
    // The keys go down before the pointer's first action and up after its last, tick for tick.
    const keys: KeyAction[] = [
      ...held.map((value): KeyAction => ({ type: "keyDown", value })),
      ...pointer.map((): KeyAction => ({ type: "pause", duration: 0 })),
      ...held.map((value): KeyAction => ({ type: "keyUp", value })),
    ];
    sequences[0] = {
      ...(sequences[0] as object),
      actions: [
        ...held.map((): PointerAction => ({ type: "pause", duration: 0 })),
        ...pointer,
        ...held.map((): PointerAction => ({ type: "pause", duration: 0 })),
      ],
    };
    sequences.push({ type: "key", id: "keyboard", actions: keys });
  }
  await drawing(() => browser.performActions(sequences as never));
}

/**
 * The straight path from `from` to `to` in `steps` moves. Each move is one event: chromedriver
 * spreads a move with a duration over ticks it waits a frame for, and a desk behind a locked
 * screen draws no frames, so a 16 ms move takes seconds there.
 */
function path(from: Point, to: Point, steps: number): PointerAction[] {
  return Array.from({ length: steps }, (_, i) =>
    at({
      x: from.x + ((to.x - from.x) * (i + 1)) / steps,
      y: from.y + ((to.y - from.y) * (i + 1)) / steps,
    }),
  );
}

/** The compositor's input events (`compositor_input`): moves, the primary button, Shift, keys. */
const toward = (p: Point) => ({ type: "pointerMoved", x: Math.round(p.x), y: Math.round(p.y) });
const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });
const shift = (on: boolean) => ({ type: "modifiers", shift: on });
const ESCAPE = [
  { type: "key", key: "Escape", code: "Escape", pressed: true },
  { type: "key", key: "Escape", code: "Escape", pressed: false },
];

/** The same straight path as compositor events. */
const line = (from: Point, to: Point, n: number) =>
  Array.from({ length: n }, (_, i) =>
    toward({
      x: from.x + ((to.x - from.x) * (i + 1)) / n,
      y: from.y + ((to.y - from.y) * (i + 1)) / n,
    }),
  );

export interface DragOptions {
  /** Moves between the two points (8 by default). */
  steps?: number;
  /** Keys held through the drag: Shift pans the canvas. */
  keys?: string[];
  /** Leave the button down at `to`: `release` lets go. */
  hold?: boolean;
}

/** Press at `from`, move to `to` and let go (unless `hold`). */
export async function drag(from: Point, to: Point, options: DragOptions = {}): Promise<void> {
  if (await composited()) {
    const { steps: n = 8, keys = [], hold = false } = options;
    const held = keys.includes(KEY.shift);
    const events = [
      toward(from),
      ...(held ? [shift(true)] : []),
      button(true),
      ...line(from, to, n),
      ...(hold ? [] : [button(false)]),
      ...(held && !hold ? [shift(false)] : []),
    ];
    await feed(events);
    return;
  }
  const { steps = 8, keys = [], hold = false } = options;
  const actions: PointerAction[] = [
    at(from),
    { type: "pointerDown", button: 0 },
    ...path(from, to, steps),
  ];
  if (!hold) actions.push({ type: "pointerUp", button: 0 });
  await perform(actions, keys);
}

/**
 * One drag through `stops`, resting `rest` ms at each, then `last` pressed (Escape, say) before the
 * button lets go: all in one WebDriver call, since chromedriver does not keep a button held from
 * one call to the next for moves. The screen is filmed meanwhile (frames.ts); the frames come back
 * in order, PNGs, for the spec to find the states the desk went through.
 */
export async function walk(
  from: Point,
  stops: Point[],
  { rest = 700, last }: { rest?: number; last?: string } = {},
): Promise<Buffer[]> {
  if (await composited()) return walkComposited(from, stops, rest, last);
  const pointer: PointerAction[] = [at(from), { type: "pointerDown", button: 0 }];
  let here = from;
  for (const stop of stops) {
    pointer.push(...path(here, stop, 6), { type: "pause", duration: rest });
    here = stop;
  }
  const keys: KeyAction[] = pointer.map((): KeyAction => ({ type: "pause", duration: 0 }));
  if (last) {
    pointer.push({ type: "pause", duration: 0 }, { type: "pause", duration: 0 });
    keys.push({ type: "keyDown", value: last }, { type: "keyUp", value: last });
  }
  pointer.push({ type: "pointerUp", button: 0 });
  keys.push({ type: "pause", duration: 0 });
  const sequences = [
    { type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: pointer },
    { type: "key", id: "keyboard", actions: keys },
  ];
  const { frames } = await filming(() => browser.performActions(sequences as never));
  await browser.releaseActions();
  return frames;
}

/**
 * `walk` on the compositor's desk: the composed frame read again and again while the pointer rests
 * at each stop, the frames in order.
 */
async function walkComposited(
  from: Point,
  stops: Point[],
  rest: number,
  last?: string,
): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  const film = async (ms: number) => {
    const until = Date.now() + ms;
    do frames.push(await composedFrame());
    while (Date.now() < until);
  };
  await feed([toward(from), button(true)]);
  let here = from;
  for (const stop of stops) {
    await feed(line(here, stop, 6));
    here = stop;
    await film(rest);
  }
  if (last === KEY.escape) {
    await feed(ESCAPE);
    await film(200);
  }
  await feed([button(false)]);
  return frames;
}

/** Let go of a held drag where the pointer is, and forget every held input. */
export async function release(): Promise<void> {
  if (await composited()) await feed([button(false), shift(false)]);
  await perform([{ type: "pointerUp", button: 0 }]);
  await browser.releaseActions();
}

/** A click, or `count` clicks in a row (2: a double-click). */
export async function click(p: Point, count = 1): Promise<void> {
  const one: PointerAction[] = [
    { type: "pointerDown", button: 0 },
    { type: "pointerUp", button: 0 },
  ];
  const actions = [at(p), ...Array.from({ length: count }, () => one).flat()];
  await perform(actions);
}

/** Press keys together, as a chord (`chord(MOD, "n")`), without letting go of a held button. */
export async function chord(...keys: string[]): Promise<void> {
  // On the compositor's desk Escape is the compositor's first: it cancels desk-wm's drag.
  if (keys.length === 1 && keys[0] === KEY.escape && (await composited())) {
    await feed(ESCAPE);
    return;
  }
  const actions: KeyAction[] = [
    ...keys.map((value): KeyAction => ({ type: "keyDown", value })),
    ...[...keys].reverse().map((value): KeyAction => ({ type: "keyUp", value })),
  ];
  await drawing(() => browser.performActions([{ type: "key", id: "keyboard", actions }] as never));
}

/** Type text, key by key. */
export async function type(text: string): Promise<void> {
  for (const key of text) await chord(key);
}

/** The wheel over `p`: `dx`, `dy` CSS pixels. */
export async function wheel(p: Point, dx: number, dy: number): Promise<void> {
  const scroll = {
    type: "scroll",
    x: Math.round(p.x),
    y: Math.round(p.y),
    deltaX: dx,
    deltaY: dy,
    duration: 0,
    origin: "viewport",
  };
  await drawing(() =>
    browser.performActions([{ type: "wheel", id: "wheel", actions: [scroll] }] as never),
  );
}

/** Eris's figure, top centre: drawn above the windows, as the bars are along the edges. */
export const ERIS: Rect = { x: 560, y: 30, w: 160, h: 160 };

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (outer: Rect, r: Rect) =>
  r.x >= outer.x &&
  r.y >= outer.y &&
  r.x + r.w <= outer.x + outer.w &&
  r.y + r.h <= outer.y + outer.h;

/**
 * A 40 px square of the screen to look at, 130 px clear of its edges (the bars) and of Eris: inside
 * `part` (or outside it, with `out`), on none of `avoid` (the dragged window, where it was).
 */
export function spot(
  part: Rect,
  avoid: Rect[],
  screen: { w: number; h: number },
  out = false,
): Rect {
  for (let y = 130; y + 40 <= screen.h - 130; y += 20) {
    for (let x = 130; x + 40 <= screen.w - 130; x += 20) {
      const r = { x, y, w: 40, h: 40 };
      const placed = out ? !overlaps(part, r) : within(part, r);
      if (placed && !overlaps(ERIS, r) && !avoid.some((a) => overlaps(a, r))) return r;
    }
  }
  throw new Error(`no quiet spot ${out ? "outside" : "inside"} ${JSON.stringify(part)}`);
}

/** A point of the empty canvas: in no window, clear of the bars and of Eris. */
export function emptyAt(desk: Desk): Point {
  const r = spot({ x: 0, y: 0, ...desk.screen }, onScreen(desk).map(rectOf), desk.screen);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
