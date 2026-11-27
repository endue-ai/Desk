// The value viewer's Shape view (PG-46): one geometry drawn fitted on a canvas, read and drawn in
// the map's worker like a Map tab's, and what it is in words: its type, SRID and vertex count (a
// circle's radius). A curve is read as lines by the viewer's own statement (`geoRead`).

import { el } from "../dom.js";
import { t } from "../strings/index.js";
import { geoClient } from "./client.js";
import { kindOf } from "./detect.js";
import { typeName } from "./geometry.js";
import { createSurface } from "./map-canvas.js";
import { GEOMETRIC } from "./pg-geometric.js";
import { fitView, unitsOf } from "./plane.js";

/**
 * @typedef {import("./detect.js").Kind} Kind
 * @typedef {import("./layer.js").Summary} Summary
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const BUILTIN = new Set(Object.values(GEOMETRIC));

/** The kind of a cell's value as a shape: by its column's OID or type name, else by how it starts. */
export function shapeKind(
  /** @type {{ value: string | null, type?: string, oid?: number }} */ cell,
) {
  if (typeof cell.value !== "string") return undefined;
  const name = (cell.type ?? "").toLowerCase();
  if (BUILTIN.has(name)) return /** @type {Kind} */ (name);
  return kindOf(cell.value, cell.oid);
}

/** What a summary's one geometry is, in words. */
export function shapeWords(/** @type {Summary} */ summary) {
  const g = summary.first;
  if (!g) return summary.unread[0] ? `${summary.unread[0].type}, not read` : "an empty shape";
  const srid = g.srid ? `SRID ${g.srid}` : "no SRID";
  const vertices = `${g.vertices.toLocaleString("en-US")} ${g.vertices === 1 ? "vertex" : "vertices"}`;
  const radius = g.radius === undefined ? [] : [`radius ${g.radius}`];
  return [typeName(/** @type {never} */ ({ ...g })), srid, vertices, ...radius].join(" · ");
}

/**
 * @param {Document} doc
 * @param {Act} act
 * @param {import("./client.js").StartWorker} [startWorker]
 */
export function createShapeView(doc, act, startWorker) {
  const client = geoClient(startWorker);
  const canvas = /** @type {HTMLCanvasElement} */ (
    el(doc, "canvas", {
      class: "geo-canvas",
      role: "img",
      "aria-label": t("geo.valueShape.theValueSShape"),
    })
  );
  const box = el(doc, "div", { class: "value-shape", hidden: true }, canvas);
  const surface = createSurface(canvas, client, { drawn() {}, failed() {} });
  let shown = 0;
  let key = "";

  return {
    el: box,
    /** Draw a value; resolves with what it is in words (undefined when another value came first). */
    async show(/** @type {string} */ value, /** @type {Kind} */ kind) {
      const asked = ++shown;
      box.hidden = false;
      if (key) void client.ask({ op: "drop", key }).catch(() => {});
      key = `value-${asked}`;
      let reply = await client.ask({ op: "load", key, kind, values: [value] });
      if (/** @type {Summary} */ (reply.summary).unread.length) {
        const texts = await act("geoRead", [value]);
        if (Array.isArray(texts)) reply = await client.ask({ op: "read", key, rows: [0], texts });
      }
      if (asked !== shown) return undefined;
      const summary = /** @type {Summary} */ (reply.summary);
      if (summary.failed) throw new Error(summary.why);
      const { width, height } = surface.size();
      const units = unitsOf(summary.srid);
      const view = fitView(summary.bounds, width, height, units, 16);
      canvas.setAttribute("aria-label", shapeWords(summary));
      surface.show({ key, view, units, picked: -1, subset: null });
      return shapeWords(summary);
    },
    hide() {
      shown++;
      box.hidden = true;
    },
  };
}
