// The motion gate's sway (#258, ADR 0213): the app window grown and shrunk on a sine while a window
// inside the desk shakes. What the trace says of it: when it ran, how far the app window went, which
// frames showed a window's picture laid out for another size (cut or padded: a picture is never
// stretched, `draw.rs` `sampled`) or the desk's own page laid out for another size than the scene
// drawn with it, and whether each window sat where the window manager put it, inside the app, with a
// picture of its size, once the app window settled. Pure: motion-sway.test.ts.
import { type Line, type Shake, shakes } from "./motion.ts";

/** The sway's span in the trace, from its first frame to its last; `cut` when the lines end first
 * (the desk ended mid-sway). */
export interface Sway {
  start: number;
  end: number;
  cut: boolean;
}

/** The first sway in `lines`, to its end or to the last line. */
export function swayOf(lines: readonly Line[]): Sway | undefined {
  const start = lines.find((l) => l.e === "sway" && l.f.phase === "start");
  if (!start) return undefined;
  const end = lines.find((l) => l.e === "sway" && l.f.phase === "end" && l.t > start.t);
  return { start: start.t, end: end?.t ?? lines.at(-1)?.t ?? start.t, cut: !end };
}

/** The shake tagged `tag`; one the desk's end cut short (an ADR 0202 restart) swings until its last
 * line, so what it measured until then still counts. */
export function shakeOf(lines: readonly Line[], tag: string): Shake | undefined {
  const whole = shakes(lines).find((s) => s.tag === tag);
  if (whole) return whole;
  const i = lines.findIndex((l) => l.e === "shake" && l.f.phase === "press" && l.f.tag === tag);
  const rest = i < 0 ? [] : lines.slice(i);
  const phase = (p: string, on?: boolean) =>
    rest.find((l) => l.e === "shake" && l.f.phase === p && (on === undefined || !!l.f.on === on));
  const on = phase("swing", true);
  const last = rest.at(-1)?.t ?? 0;
  if (!on) return undefined;
  const off = phase("swing", false)?.t ?? last;
  const released = phase("release")?.t ?? off;
  return { tag, pressed: rest[0]?.t ?? 0, swing: [on.t, off], released, done: last, lines: rest };
}

/** The part of `shake`'s swing the sway overlaps, as `timing` reads a shake: both moving. */
export function overlap(shake: Shake, sway: Sway): Shake | undefined {
  const from = Math.max(shake.swing[0], sway.start);
  const to = Math.min(shake.swing[1], sway.end);
  return to > from ? { ...shake, swing: [from, to] } : undefined;
}

/** A picture of `texture` device pixels drawn at `w`×`h` logical ones: of that size (a pixel
 * either way for rounding), larger and cut, or smaller and padded with the window's fill. */
export type Fit = "fits" | "cut" | "padded";

export function fitted(
  texture: readonly number[] | undefined,
  w: number,
  h: number,
  scale: number,
) {
  if (!texture) return undefined;
  const [tw = 0, th = 0] = texture;
  const [ew, eh] = [Math.round(w * scale), Math.round(h * scale)];
  if (Math.abs(tw - ew) <= 1 && Math.abs(th - eh) <= 1) return "fits" as Fit;
  return (tw > ew + 1 || th > eh + 1 ? "cut" : "padded") as Fit;
}

/** What the frames between `from` and `to` showed: each frame is the layout traced last before it. */
export interface Pictures {
  frames: number;
  /** Frames where a window's picture did not fit the place it was drawn at. */
  unfit: number;
  /** By window surface, the frames its picture was cut and padded. */
  windows: Record<string, { cut: number; padded: number }>;
  /** Frames where the desk's own page was laid out for another size than the scene drawn with it
   * (its windows' places, its bars' boxes). */
  deskUnfit: number;
  /** Frames where it trailed the app window's size, for the record: a resize every 8 ms outruns
   * any page, and a picture cropped or padded is drawn there. */
  deskStale: number;
  /** The app window's least and largest width and height meanwhile, logical pixels. */
  widths: [number, number];
  heights: [number, number];
}

/** A `win` line's fields (`frame_trace::laid_out`), with its pictures. */
interface Laid {
  windows: { id: string; rect: number[] }[];
  surfaces: [string, number, number, number, number][];
  textures: Record<string, number[]>;
  pageTexture: number[] | null;
  /** The size the desk's page laid the scene out for (logical pixels). */
  screen?: number[];
  viewport: number[];
  scale: number;
}

export function pictures(lines: readonly Line[], from: number, to: number): Pictures {
  const out: Pictures = {
    frames: 0,
    unfit: 0,
    windows: {},
    deskUnfit: 0,
    deskStale: 0,
    widths: [Number.POSITIVE_INFINITY, 0],
    heights: [Number.POSITIVE_INFINITY, 0],
  };
  let laid: Laid | undefined;
  for (const line of lines) {
    if (line.e === "win" && line.f.textures) laid = line.f as Laid;
    if (line.e !== "frame" || line.t < from || line.t > to || !laid) continue;
    out.frames++;
    const { scale, viewport, textures } = laid;
    const [vw = 0, vh = 0] = viewport.map((v) => v / scale);
    out.widths = [Math.min(out.widths[0], vw), Math.max(out.widths[1], vw)];
    out.heights = [Math.min(out.heights[0], vh), Math.max(out.heights[1], vh)];
    let unfit = false;
    for (const [surface, , , w, h] of laid.surfaces) {
      if (!surface.startsWith("window:")) continue;
      const f = fitted(textures[surface], w, h, scale);
      if (f !== "cut" && f !== "padded") continue;
      unfit = true;
      out.windows[surface] ??= { cut: 0, padded: 0 };
      out.windows[surface][f]++;
    }
    const page = laid.pageTexture ?? undefined;
    const [sw = vw, sh = vh] = laid.screen ?? [];
    if (fitted(page, sw, sh, scale) !== "fits") out.deskUnfit++;
    if (unfit) out.unfit++;
    if (fitted(page, vw, vh, scale) !== "fits") out.deskStale++;
  }
  if (!out.frames) out.widths = out.heights = [0, 0];
  return out;
}

/** What is amiss in the layout `win` once the app window settled: the desk's page laid out for
 * another size; a window outside the app, drawn off the place the window manager gave it, not
 * from its own page, or with a picture of another size. Positions forgive a pixel (#250's snap). */
export function unsettled(win: Line | undefined): string[] {
  if (!win?.f.textures) return ["no layout with its pictures was traced after the sway"];
  const { windows, surfaces, textures, scale, viewport, pageTexture } = win.f as Laid;
  const [vw = 0, vh = 0] = viewport.map((v) => v / scale);
  const size = (s: readonly number[] | null | undefined) => (s ? s.join("×") : "none");
  const faults: string[] = [];
  if (fitted(pageTexture ?? undefined, vw, vh, scale) !== "fits") {
    faults.push(`the desk's page is ${size(pageTexture)} for an app of ${size(viewport)}`);
  }
  const [sw = vw, sh = vh] = (win.f as Laid).screen ?? [];
  if (Math.abs(sw - vw) > 1 || Math.abs(sh - vh) > 1) {
    faults.push(`the desk laid its scene out for ${sw}×${sh}, not the app's ${vw}×${vh}`);
  }
  const off = (a: readonly number[], b: readonly number[]) =>
    a.some((v, i) => Math.abs(v - (b[i] ?? 0)) > 1);
  for (const w of windows) {
    const [x = 0, y = 0, width = 0, h = 0] = w.rect;
    const at = w.rect.map((v) => Math.round(v)).join(",");
    if (x < -1 || y < -1 || x + width > vw + 1 || y + h > vh + 1) {
      faults.push(`${w.id} at ${at} lies outside the app's ${Math.round(vw)}×${Math.round(vh)}`);
    }
    const surface = `window:${w.id}`;
    const placed = surfaces.find((s) => s[0] === surface);
    if (!placed) {
      faults.push(`${w.id} is not drawn from its own page`);
      continue;
    }
    const [, ...rect] = placed;
    if (off(rect, w.rect)) faults.push(`${w.id} is drawn at ${rect.join(",")}, not at ${at}`);
    const [, , , pw, ph] = placed;
    const f = fitted(textures[surface], pw, ph, scale);
    if (f !== "fits") {
      faults.push(
        `${w.id}'s picture is ${size(textures[surface])} for ${pw}×${ph} (${f ?? "none"})`,
      );
    }
  }
  return faults;
}

/** The last layout traced with its pictures up to `t`. */
export function lastLaid(lines: readonly Line[], t = Number.POSITIVE_INFINITY): Line | undefined {
  return lines.findLast((l) => l.e === "win" && l.t <= t && l.f.textures);
}
