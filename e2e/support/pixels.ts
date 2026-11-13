// Screenshot oracles for the windows-* specs (#82), where a rect is not enough: what the desk shows
// in a part of the screen, compared with what it showed before or elsewhere (a window dragged and
// held shows its own pixels under the pointer; a frame keeps its pixels through a move). The
// screenshot is the desk's whole viewport through WebDriver, decoded here (8-bit RGB or RGBA PNG,
// as Chromium writes it) and scaled to CSS pixels by the screen's width. Taking one also draws a
// frame, which a desk hidden behind a locked screen otherwise does not (no animation frames run).
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser } from "@wdio/globals";
import { decodePng, type Image } from "./png";
import type { Rect } from "./windows";

export { decodePng, type Image } from "./png";

let captures = 0;

/**
 * The compositor's frame (compositor mode, #81): the page alone leaves the windows unpainted, so the
 * desk's development build reads its composed frame back (`compositor_capture`) into a file.
 */
export async function composedFrame(): Promise<Buffer> {
  const path = join(tmpdir(), `desk-e2e-frame-${process.pid}-${++captures}.png`);
  const error = await browser.execute(
    (file: string) =>
      new Promise<string | null>((done) => {
        type Native = { send(text: string): void; onMessage?: (text: string) => void };
        const native = (globalThis as { __deskNative?: Native }).__deskNative;
        if (!native) return done("no __deskNative");
        const before = native.onMessage;
        const id = 900_000 + Math.floor(Math.random() * 99_999);
        native.onMessage = (text: string) => {
          const answer = JSON.parse(text) as { id?: number; error?: string };
          if (answer.id !== id) return before?.(text);
          native.onMessage = before;
          done(answer.error ?? null);
        };
        native.send(JSON.stringify({ id, cmd: "compositor_capture", args: { path: file } }));
      }),
    path,
  );
  if (error) throw new Error(`the compositor did not capture its frame: ${String(error)}`);
  const png = readFileSync(path);
  rmSync(path, { force: true });
  return png;
}

/** The desk's viewport now, `cssWidth` CSS pixels wide (desk.windows.list's screen). */
export async function screenshot(cssWidth: number): Promise<Image> {
  return decodePng(await composedFrame(), cssWidth);
}

/**
 * The desk once it has drawn what just changed: windows glide into place over 400 ms (ADR 0128),
 * and a desk behind a locked screen draws only when asked.
 */
export async function settled(cssWidth: number): Promise<Image> {
  // Eris's figure turns all the time, so the screen is never still as a whole: the glides and the
  // preview run on the clock, and a frame drawn once their time has passed shows where they end.
  await browser.takeScreenshot();
  await browser.pause(GLIDE_MS);
  await browser.takeScreenshot();
  await browser.pause(100);
  return screenshot(cssWidth);
}

/** The glide's 400 ms (ADR 0128) and a frame's margin. */
const GLIDE_MS = 450;

/**
 * How much of `a` inside `ra` differs from `b` inside `rb` (rects of the same size, in CSS pixels):
 * the share of device pixels whose colour moved by more than `tolerance` on any channel. Edges are
 * left out by `inset` CSS pixels, where shadows and rounded corners meet what lies around.
 */
export function difference(
  a: Image,
  ra: Rect,
  b: Image,
  rb: Rect,
  { inset = 0, tolerance = 8 } = {},
): number {
  const s = a.scale;
  const w = Math.floor((Math.min(ra.w, rb.w) - 2 * inset) * s);
  const h = Math.floor((Math.min(ra.h, rb.h) - 2 * inset) * s);
  if (w <= 0 || h <= 0) throw new Error("nothing left to compare");
  const ax = Math.round((ra.x + inset) * s);
  const ay = Math.round((ra.y + inset) * s);
  const bx = Math.round((rb.x + inset) * b.scale);
  const by = Math.round((rb.y + inset) * b.scale);
  let differing = 0;
  let counted = 0;
  for (let y = 0; y < h; y++) {
    const ya = ay + y;
    const yb = by + y;
    if (ya < 0 || yb < 0 || ya >= a.height || yb >= b.height) continue;
    for (let x = 0; x < w; x++) {
      const xa = ax + x;
      const xb = bx + x;
      if (xa < 0 || xb < 0 || xa >= a.width || xb >= b.width) continue;
      const oa = (ya * a.width + xa) * 4;
      const ob = (yb * b.width + xb) * 4;
      counted++;
      for (let c = 0; c < 3; c++) {
        if (Math.abs((a.data[oa + c] ?? 0) - (b.data[ob + c] ?? 0)) > tolerance) {
          differing++;
          break;
        }
      }
    }
  }
  return counted ? differing / counted : 0;
}

/** One device pixel's RGBA, or undefined outside the image. */
export function pixel(img: Image, x: number, y: number): number[] | undefined {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return undefined;
  const o = (y * img.width + x) * 4;
  return [img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0];
}
