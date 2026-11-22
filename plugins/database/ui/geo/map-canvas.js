// The map's canvas in the frame (PG-46): it only puts bitmaps the worker drew on the screen. A pan
// or a zoom moves and scales the last bitmap at once, and asks the worker for the new view; one
// request is in flight at a time and the latest view is the next one asked, so a fast gesture never
// queues up work. The theme's colours are read here and sent with each request.

import { toScreen } from "./plane.js";

/**
 * @typedef {import("./plane.js").View} View
 * @typedef {import("./plane.js").Units} Units
 * @typedef {import("./draw.js").Style} Style
 * @typedef {import("./draw.js").Drawn} Drawn
 * @typedef {import("./client.js").GeoClient} GeoClient
 */

/**
 * The desk's chart colours that read at 3:1 as marks on the plane in its light and dark schemes
 * (geo-draw.test.ts), in an order that keeps neighbouring rows' hues apart.
 */
export const CHARTS = [1, 8, 5, 6, 4, 9, 7, 10];

/** The theme's colours and the graticule's font, as the canvas takes them. */
export function themeOf(/** @type {Element} */ node) {
  const style = node.ownerDocument.defaultView?.getComputedStyle(node);
  const token = (/** @type {string} */ name) => style?.getPropertyValue(name).trim() ?? "";
  return {
    colors: CHARTS.map((n) => token(`--desk-chart-${n}`)),
    accent: token("--desk-primary"),
    grid: token("--desk-border"),
    label: token("--desk-text-muted"),
    font: `${token("--desk-text-2xs")} ${token("--desk-font-mono")}`.trim(),
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {GeoClient} client
 * @param {{ drawn(drawn: Drawn, ms: number): void, failed(error: unknown): void }} hooks
 */
export function createSurface(canvas, client, hooks) {
  /** @type {ImageBitmap | undefined} */
  let bitmap;
  /** @type {View | undefined} */
  let bitmapView;
  /** @type {{ key: string, view: View, units: Units, picked: number, subset: number[] | null } | undefined} */
  let wanted;
  let inflight = false;
  const size = () => {
    const box = canvas.parentElement;
    return {
      width: Math.max(1, box?.clientWidth || 640),
      height: Math.max(1, box?.clientHeight || 360),
      ratio: canvas.ownerDocument.defaultView?.devicePixelRatio || 1,
    };
  };

  /** The last bitmap, moved and scaled from the view it was drawn at to the one on screen. */
  const blit = () => {
    const { width, height, ratio } = size();
    const w = Math.round(width * ratio);
    const h = Math.round(height * ratio);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    let ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!bitmap || !bitmapView || !wanted) return;
    const k = wanted.view.scale / bitmapView.scale;
    const [sx, sy] = toScreen(wanted.view, bitmapView.cx, bitmapView.cy, width, height);
    const dw = (bitmap.width / ratio) * k;
    const dh = (bitmap.height / ratio) * k;
    ctx.drawImage(bitmap, (sx - dw / 2) * ratio, (sy - dh / 2) * ratio, dw * ratio, dh * ratio);
  };

  const send = async () => {
    inflight = true;
    while (wanted) {
      const asked = wanted;
      const { width, height, ratio } = size();
      /** @type {Style} */
      const style = {
        ...themeOf(canvas),
        width,
        height,
        picked: asked.picked,
        subset: asked.subset,
        units: asked.units,
      };
      try {
        const reply = await client.ask({
          op: "draw",
          key: asked.key,
          view: asked.view,
          style,
          ratio,
        });
        const next = /** @type {ImageBitmap | undefined} */ (reply.bitmap);
        if (next) {
          bitmap?.close?.();
          bitmap = next;
          bitmapView = asked.view;
        }
        hooks.drawn(/** @type {Drawn} */ (reply.drawn), Number(reply.ms));
      } catch (error) {
        hooks.failed(error);
      }
      blit();
      if (wanted === asked) break;
    }
    inflight = false;
  };

  return {
    /** Show a view: the last bitmap moved at once, the view itself once the worker drew it. */
    show(/** @type {NonNullable<typeof wanted>} */ next) {
      const sameLayer = wanted?.key === next.key;
      wanted = next;
      if (!sameLayer) {
        bitmap?.close?.();
        bitmap = undefined;
      }
      blit();
      if (!inflight) void send();
    },
    /** The canvas's size in CSS pixels. */
    size,
  };
}
