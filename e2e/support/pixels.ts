// Screenshot oracles for the windows-* specs (#82), where a rect is not enough: what the desk shows
// in a part of the screen, compared with what it showed before or elsewhere (a window dragged and
// held shows its own pixels under the pointer; a frame keeps its pixels through a move). The
// screenshot is the desk's whole viewport through WebDriver, decoded here (8-bit RGB or RGBA PNG,
// as Chromium writes it) and scaled to CSS pixels by the screen's width. Taking one also draws a
// frame, which a desk hidden behind a locked screen otherwise does not (no animation frames run).
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { browser } from "@wdio/globals";
import { composited } from "./desk";
import type { Rect } from "./windows";

export interface Image {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8Array;
  /** Device pixels per CSS pixel. */
  scale: number;
}

/** Decode a PNG of 8-bit RGB or RGBA, not interlaced. */
export function decodePng(png: Buffer, cssWidth?: number): Image {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const kind = png.toString("ascii", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0)
        throw new Error(`PNG depth ${depth} colour ${color} interlace ${interlace} not read here`);
      channels = color === 6 ? 4 : 3;
    } else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (row[i - channels] ?? 0) : 0;
      const b = previous[i] ?? 0;
      const c = i >= channels ? (previous[i - channels] ?? 0) : 0;
      const v = line[i] ?? 0;
      const predicted =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? (a + b) >> 1
              : filter === 4
                ? paeth(a, b, c)
                : 0;
      row[i] = (v + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = row[x * channels] ?? 0;
      out[o + 1] = row[x * channels + 1] ?? 0;
      out[o + 2] = row[x * channels + 2] ?? 0;
      out[o + 3] = channels === 4 ? (row[x * channels + 3] ?? 255) : 255;
    }
    previous = row;
  }
  return { width, height, data: out, scale: cssWidth ? width / cssWidth : 1 };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

let captures = 0;

/**
 * The compositor's frame (compositor mode, #81): the page alone leaves the windows unpainted, so the
 * desk's development build reads its composed frame back (`compositor_capture`) into a file.
 */
async function composedFrame(): Promise<Buffer> {
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
  if (await composited()) return decodePng(await composedFrame(), cssWidth);
  return decodePng(Buffer.from(await browser.takeScreenshot(), "base64"), cssWidth);
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
