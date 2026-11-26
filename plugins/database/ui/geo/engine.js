// What the map's worker answers (PG-46, worker.js), and the frame when it has no worker: a column's
// values read into a layer once, the curves the server read back put in, a view drawn on an
// OffscreenCanvas and handed back as a bitmap, the row under a point, a layer let go. Requests and
// replies are plain data; a reply's bitmap is transferred. Pure but for the canvas it makes.

import { t } from "../strings/index.js";
import { drawLayer } from "./draw.js";
import {
  boundsOfRows,
  buildLayer,
  factsOf,
  pickAt,
  readBack,
  stepFrom,
  summaryOf,
} from "./layer.js";

/**
 * @typedef {import("./detect.js").Kind} Kind
 * @typedef {import("./plane.js").View} View
 * @typedef {import("./draw.js").Style} Style
 * @typedef {import("./draw.js").Context} Context
 * @typedef {import("./layer.js").Layer} Layer
 * @typedef {(
 *   | { op: "load", key: string, kind: Kind, values: (string | null)[] }
 *   | { op: "read", key: string, rows: number[], texts: (string | null)[] }
 *   | { op: "draw", key: string, view: View, style: Style, ratio: number }
 *   | { op: "pick", key: string, x: number, y: number, tolerance: number, kx: number, subset: number[] | null }
 *   | { op: "step", key: string, from: number, delta: number, subset: number[] | null }
 *   | { op: "bounds", key: string, subset: number[] | null }
 *   | { op: "facts", key: string, row: number }
 *   | { op: "drop", key: string }
 * ) & { id: number }} Request
 * @typedef {{ id: number, [field: string]: unknown }} Reply
 * @typedef {{ getContext(kind: "2d"): Context | null, transferToImageBitmap?(): ImageBitmap }} Surface
 * @typedef {(width: number, height: number) => Surface | null} MakeSurface
 */

/** An OffscreenCanvas where the engine runs has one; null where it has none (Node). */
const offscreen = /** @type {MakeSurface} */ (
  (width, height) =>
    typeof OffscreenCanvas === "function"
      ? /** @type {Surface} */ (/** @type {unknown} */ (new OffscreenCanvas(width, height)))
      : null
);

/** A context that draws nothing, for counting what a view holds where there is no canvas. */
const NOTHING = /** @type {Context} */ (
  /** @type {unknown} */ (
    new Proxy({}, { get: (_, name) => (name === "font" ? "" : () => undefined), set: () => true })
  )
);

/** @param {MakeSurface} [make] */
export function createEngine(make = offscreen) {
  /** @type {Map<string, Layer>} */
  const layers = new Map();
  const layerOf = (/** @type {string} */ key) => {
    const layer = layers.get(key);
    if (!layer) throw new Error(t("geo.engine.theMapSValuesAreGone"));
    return layer;
  };

  /** @param {Request} request @returns {{ reply: Reply, transfer: Transferable[] }} */
  const answer = (request) => {
    const { id } = request;
    try {
      if (request.op === "load") {
        const layer = buildLayer(request.values, request.kind);
        layers.set(request.key, layer);
        return { reply: { id, summary: summaryOf(layer) }, transfer: [] };
      }
      if (request.op === "read") {
        const layer = layerOf(request.key);
        readBack(layer, request.rows, request.texts);
        return { reply: { id, summary: summaryOf(layer) }, transfer: [] };
      }
      if (request.op === "draw") {
        const layer = layerOf(request.key);
        const { width, height } = request.style;
        const ratio = request.ratio || 1;
        const started = performance.now();
        const surface = make(
          Math.max(1, Math.round(width * ratio)),
          Math.max(1, Math.round(height * ratio)),
        );
        const ctx = surface?.getContext("2d") ?? null;
        if (ctx)
          /** @type {CanvasRenderingContext2D} */ (/** @type {unknown} */ (ctx)).scale(
            ratio,
            ratio,
          );
        const drawn = drawLayer(ctx ?? NOTHING, layer, request.view, request.style);
        const bitmap = ctx ? surface?.transferToImageBitmap?.() : undefined;
        const ms = Math.round(performance.now() - started);
        return {
          reply: { id, drawn, ms, ...(bitmap ? { bitmap } : {}) },
          transfer: bitmap ? [bitmap] : [],
        };
      }
      if (request.op === "pick") {
        const { x, y, tolerance, kx, subset } = request;
        const layer = layerOf(request.key);
        const row = pickAt(layer, x, y, tolerance, kx, subset ? new Set(subset) : null);
        return { reply: { id, row, facts: factsOf(layer, row) }, transfer: [] };
      }
      if (request.op === "step") {
        const layer = layerOf(request.key);
        const { from, delta, subset } = request;
        const row = stepFrom(layer, from, delta, subset ? new Set(subset) : null);
        return { reply: { id, row, facts: factsOf(layer, row) }, transfer: [] };
      }
      if (request.op === "facts")
        return { reply: { id, facts: factsOf(layerOf(request.key), request.row) }, transfer: [] };
      if (request.op === "bounds") {
        const { subset } = request;
        const bounds = boundsOfRows(layerOf(request.key), subset ? new Set(subset) : null);
        return { reply: { id, bounds }, transfer: [] };
      }
      layers.delete(request.key);
      return { reply: { id }, transfer: [] };
    } catch (error) {
      return {
        reply: { id, error: error instanceof Error ? error.message : String(error) },
        transfer: [],
      };
    }
  };
  return { answer, layers };
}
