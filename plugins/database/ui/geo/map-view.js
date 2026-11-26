// A result's Map tab (PG-46): the shapes of a spatial column on a plain plane with a graticule and
// a scale, no tiles and nothing fetched. Its bar picks the column, all rows held or the rows the
// grid had selected, and fits or zooms (the canvas's own keys: map-input.js). A picked row is said
// under the map with its values, and Show in grid opens the rows tab with the cursor on it; the
// grid's block when the tab opened is what Selected rows draws. The worker reads the values; curves
// come back as GeoJSON from the viewer's own statement (`geoRead`, features/geo/), never the person's.

import { el } from "../dom.js";
import { t } from "../strings/index.js";
import { geoClient } from "./client.js";
import { createSurface } from "./map-canvas.js";
import { wireInput } from "./map-input.js";
import { fitView, fixed, scaleBar, toData, unitsOf, zoomAt } from "./plane.js";

/**
 * @typedef {import("../tabs.js").Tab} Tab
 * @typedef {NonNullable<Tab["geo"]>} Geo
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("./plane.js").View} View
 * @typedef {import("./layer.js").Summary} Summary
 * @typedef {import("./geometry.js").Bounds} Bounds
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {{ type: string, srid: number, vertices: number } | null} Facts
 * @typedef {{ mode: "all" | "selected", selected: number[], picked: number, facts: Facts, column: number }} Link
 *   What the map of a set shares across its columns: which rows, the grid's selection, the pick.
 * @typedef {{ key: string, view: View | null, summary: Summary | null, loading: Promise<void> | null, generation: number }} Layer
 */

let made = 0;

/** @param {Document} doc @param {Act} act @param {import("./client.js").StartWorker} [startWorker] */
export function createMaps(doc, act, startWorker) {
  const client = geoClient(startWorker);
  /** @type {WeakMap<ResultSet, { link: Link, layers: Layer[] }>} */
  const sets = new WeakMap();
  /** @type {WeakMap<ResultSet, number>} */
  const gotos = new WeakMap();
  /** @type {{ geo: Geo, link: Link, layer: Layer } | null} */
  let on = null;

  const button = (
    /** @type {string} */ label,
    /** @type {string} */ title,
    /** @type {() => unknown} */ run,
  ) => {
    const b = el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet", title }, label);
    b.addEventListener("click", () => void run());
    return b;
  };
  const column = /** @type {HTMLSelectElement} */ (
    el(doc, "select", { class: "desk-field geo-column", "aria-label": t("map.column") })
  );
  const rowsTabs = el(doc, "div", {
    class: "desk-tabs geo-rows",
    role: "tablist",
    "aria-label": t("map.rows"),
  });
  const canvas = /** @type {HTMLCanvasElement} */ (
    el(doc, "canvas", { class: "geo-canvas", tabindex: "0", role: "img" })
  );
  const scaleLine = el(doc, "span", { class: "geo-scale-bar" });
  const scaleText = el(doc, "span", { class: "geo-scale-text" });
  const coords = el(doc, "span", { class: "geo-at", "aria-hidden": "true" });
  const said = el(doc, "span", { class: "geo-said", role: "status", "aria-live": "polite" });
  const inGrid = button(t("map.showInGrid"), t("map.showInGridTitle"), () => showInGrid());
  const note = el(doc, "p", { class: "geo-note", hidden: true });
  const root = el(
    doc,
    "div",
    { class: "geo-box" },
    el(
      doc,
      "div",
      { class: "geo-bar", role: "toolbar", "aria-label": t("map.label") },
      column,
      rowsTabs,
      el(doc, "span", { class: "grow" }),
      button(t("map.fit"), t("map.fitTitle"), () => refit()),
      button(t("map.zoomIn"), t("map.zoomInTitle"), () => zoomBy(2)),
      button(t("map.zoomOut"), t("map.zoomOutTitle"), () => zoomBy(0.5)),
    ),
    el(
      doc,
      "div",
      { class: "geo-plane" },
      canvas,
      el(doc, "div", { class: "geo-scale", "aria-hidden": "true" }, scaleLine, scaleText),
    ),
    el(doc, "div", { class: "geo-info" }, said, coords, inGrid),
    note,
  );
  const surface = createSurface(canvas, client, {
    drawn(drawn, ms) {
      root.dataset.shapes = String(drawn.shapes);
      root.dataset.ms = String(ms);
      root.removeAttribute("aria-busy");
    },
    failed: (error) => failed(error),
  });

  /** A set's link and its column's layer, made once. */
  const entryOf = (/** @type {Geo} */ geo) => {
    let entry = sets.get(geo.set);
    if (!entry) {
      entry = {
        link: { mode: "all", selected: [], picked: -1, facts: null, column: 0 },
        layers: [],
      };
      sets.set(geo.set, entry);
    }
    const c = Math.min(entry.link.column, geo.columns.length - 1);
    entry.layers[c] ??= {
      key: `map-${++made}`,
      view: null,
      summary: null,
      loading: null,
      generation: -1,
    };
    return { link: entry.link, layer: /** @type {Layer} */ (entry.layers[c]) };
  };
  const units = () => unitsOf(on?.layer.summary?.srid ?? 0);
  const subset = () => (on?.link.mode === "selected" ? on.link.selected : null);

  const failed = (/** @type {unknown} */ error) => {
    root.removeAttribute("aria-busy");
    if (on && on.layer.generation !== client.generation) {
      on.layer.summary = null;
      return void draw();
    }
    act("say", t("map.failed", { error: error instanceof Error ? error.message : String(error) }));
  };

  /** Read the column into the worker once (again after a worker stopped); the curves through the server. */
  const load = (/** @type {Geo} */ geo, /** @type {Link} */ link, /** @type {Layer} */ layer) => {
    if (layer.summary && layer.generation === client.generation) return Promise.resolve();
    const spatial = geo.columns[link.column];
    if (layer.loading || !spatial) return layer.loading ?? Promise.resolve();
    root.setAttribute("aria-busy", "true");
    said.textContent = t("map.reading", { count: geo.set.rows.length });
    layer.generation = client.generation;
    const values = geo.set.rows.map((row) => row[spatial.column] ?? null);
    layer.loading = (async () => {
      let reply = await client.ask({ op: "load", key: layer.key, kind: spatial.kind, values });
      const unread = /** @type {Summary} */ (reply.summary).unread.map((u) => u.row);
      if (unread.length) {
        const texts = await act(
          "geoRead",
          unread.map((row) => values[row] ?? null),
        );
        if (Array.isArray(texts))
          reply = await client.ask({ op: "read", key: layer.key, rows: unread, texts });
      }
      layer.summary = /** @type {Summary} */ (reply.summary);
    })().finally(() => {
      layer.loading = null;
    });
    return layer.loading;
  };

  /** The view that shows what is drawn whole: the selected rows' box, or the layer's. */
  const fitted = async (/** @type {Layer} */ layer) => {
    const asked = subset();
    const reply = asked ? await client.ask({ op: "bounds", key: layer.key, subset: asked }) : null;
    const bounds = /** @type {Bounds | null} */ (reply?.bounds ?? layer.summary?.bounds ?? null);
    const { width, height } = surface.size();
    return fitView(bounds, width, height, unitsOf(layer.summary?.srid ?? 0));
  };

  /** Draw the map on screen as its link and layer say. */
  const draw = async () => {
    if (!on) return;
    const { geo, link, layer } = on;
    try {
      await load(geo, link, layer);
      layer.view ??= await fitted(layer);
      if (link.picked >= 0 && !link.facts) {
        const reply = await client.ask({ op: "facts", key: layer.key, row: link.picked });
        link.facts = /** @type {Facts} */ (reply.facts ?? null);
      }
    } catch (error) {
      return failed(error);
    }
    if (on?.layer !== layer || !layer.view) return;
    surface.show({
      key: layer.key,
      view: layer.view,
      units: units(),
      picked: link.picked,
      subset: subset(),
    });
    words();
  };

  /** The scale, the notes, the picked row and what the canvas is, from the state. */
  const words = () => {
    if (!on?.layer.view) return;
    const { geo, link, layer } = on;
    const s = layer.summary;
    const bar = scaleBar(layer.view, units());
    scaleLine.style.width = `${Math.round(bar.px)}px`;
    scaleText.textContent = bar.label;
    const kinds = s
      ? Object.entries(s.types)
          .map(([type, n]) => t("map.kind", { count: n, type }))
          .join(", ")
      : "";
    const srid = s?.srid ? t("map.srid", { srid: String(s.srid) }) : t("map.noSrid");
    const name = geo.columns[link.column]?.name ?? "";
    const shapes = kinds || t("map.noShapes");
    canvas.setAttribute("aria-label", t("map.canvas", { column: name, kinds: shapes, srid }));
    const notes = [];
    const curves = s?.unread.length ?? 0;
    if (curves) notes.push(t("map.curves", { count: curves }));
    if (s?.failed) notes.push(t("map.unread", { count: s.failed, why: s.why }));
    if (s && s.srids > 1) notes.push(t("map.srids"));
    note.hidden = notes.length === 0;
    note.textContent = notes.join(" ");
    inGrid.hidden = link.picked < 0;
    said.textContent =
      pickedWords(geo, link) || (s ? t("map.shapes", { count: s.shapes, srid }) : "");
  };

  /** The picked row: its number, up to three of its other values, its shape's type and vertices. */
  const pickedWords = (/** @type {Geo} */ geo, /** @type {Link} */ link) => {
    if (link.picked < 0) return "";
    const row = geo.set.rows[link.picked] ?? [];
    const spatial = new Set(geo.columns.map((c) => c.column));
    const values = geo.set.columns
      .flatMap((name, c) => (spatial.has(c) ? [] : [`${name} ${row[c] ?? "NULL"}`]))
      .slice(0, 3);
    const f = link.facts;
    const facts = f ? [f.type, t("map.vertices", { count: f.vertices })] : [t("map.noShape")];
    return [t("map.row", { count: link.picked + 1 }), ...values, ...facts].join(" · ");
  };

  const setView = (/** @type {View} */ view) => {
    if (!on) return;
    on.layer.view = view;
    void draw();
  };
  const zoomBy = (
    /** @type {number} */ factor,
    /** @type {number} */ x = Number.NaN,
    y = Number.NaN,
  ) => {
    const { width, height } = surface.size();
    const view = on?.layer.view;
    if (view)
      setView(
        zoomAt(
          view,
          factor,
          Number.isNaN(x) ? width / 2 : x,
          Number.isNaN(y) ? height / 2 : y,
          width,
          height,
        ),
      );
  };
  const refit = async () => {
    if (!on?.layer.summary) return;
    setView(await fitted(on.layer).catch(() => fitView(null, 1, 1, "units")));
  };
  // Picks run one after another, so quick N presses each step from the row the last one picked.
  let picking = Promise.resolve();
  const pick = (/** @type {Record<string, unknown> | (() => Record<string, unknown>)} */ ask) =>
    (picking = picking.then(() => picked(typeof ask === "function" ? ask() : ask)));
  const picked = async (/** @type {Record<string, unknown>} */ ask) => {
    if (!on?.layer.summary) return;
    const { link, layer } = on;
    const reply = await client
      .ask(/** @type {never} */ ({ key: layer.key, subset: subset(), ...ask }))
      .catch(() => null);
    if (!reply || on?.layer !== layer) return;
    link.picked = Number(reply.row);
    link.facts = /** @type {Facts} */ (reply.facts ?? null);
    await draw();
  };
  const showInGrid = () => {
    if (!on || on.link.picked < 0) return;
    gotos.set(on.geo.set, on.link.picked);
    act("showSet", on.geo.set);
  };

  wireInput(canvas, {
    view: () => on?.layer.view ?? null,
    size: () => surface.size(),
    setView,
    zoomBy,
    refit: () => void refit(),
    pickAt(px, py) {
      const view = on?.layer.view;
      if (!view) return Promise.resolve();
      const { width, height } = surface.size();
      const [x, y] = toData(view, px, py, width, height);
      return pick({ op: t("geo.mapView.pick"), x, y, tolerance: 4 / view.scale, kx: view.kx });
    },
    step: (delta) => void pick(() => ({ op: "step", from: on?.link.picked ?? -1, delta })),
    showInGrid: () => void picking.then(showInGrid),
    unpick() {
      if (!on || on.link.picked < 0) return false;
      on.link.picked = -1;
      void draw();
      return true;
    },
    hover(px, py) {
      const view = on?.layer.view;
      if (!view) return;
      const { width, height } = surface.size();
      const [x, y] = toData(view, px, py, width, height);
      coords.textContent = t("map.at", {
        x: fixed(x, 1 / (view.scale * view.kx)),
        y: fixed(y, 1 / view.scale),
      });
    },
  });
  column.addEventListener("change", () => {
    if (!on) return;
    on.link.column = Number(column.value);
    paint(on.geo);
  });
  rowsTabs.addEventListener("click", (event) => {
    const mode = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[data-mode]");
    if (!on || !mode) return;
    on.link.mode = /** @type {Link["mode"]} */ (/** @type {HTMLElement} */ (mode).dataset.mode);
    on.layer.view = null;
    paint(on.geo);
  });

  /** The bar for a set's map, then the map. */
  const paint = (/** @type {Geo} */ geo) => {
    const { link, layer } = entryOf(geo);
    on = { geo, link, layer };
    column.replaceChildren(
      ...geo.columns.map((c, i) =>
        el(doc, "option", { value: String(i), selected: i === link.column }, c.name),
      ),
    );
    column.hidden = geo.columns.length < 2;
    const modes = /** @type {const} */ ([
      [
        "all",
        t(geo.set.truncated ? "map.rowsHeld" : "map.allRows", { count: geo.set.rows.length }),
      ],
      ["selected", t("map.selectedRows", { count: link.selected.length })],
    ]);
    rowsTabs.replaceChildren(
      ...modes.map(([mode, label]) =>
        el(
          doc,
          "button",
          {
            type: "button",
            role: "tab",
            class: "desk-tab",
            "data-mode": mode,
            "aria-selected": String(link.mode === mode),
            disabled: mode === "selected" && link.selected.length === 0,
          },
          label,
        ),
      ),
    );
    void draw();
  };

  return {
    /** Draw a Map tab into the results' box. */
    show(/** @type {HTMLElement} */ host, /** @type {Tab} */ tab) {
      if (!tab.geo) return;
      if (host.firstChild !== root || host.childNodes.length !== 1) host.replaceChildren(root);
      paint(tab.geo);
    },
    /** The grid left a set's rows tab for its map: the rows its block covered, its cursor's row. */
    leave(
      /** @type {ResultSet} */ set,
      /** @type {number[]} */ rows,
      /** @type {number | undefined} */ cursor,
    ) {
      const entry = sets.get(set);
      const link = entry?.link ?? { mode: "all", selected: [], picked: -1, facts: null, column: 0 };
      link.selected = rows.length > 1 ? [...rows] : [];
      link.mode = link.selected.length ? "selected" : "all";
      link.picked = cursor ?? -1;
      link.facts = null;
      for (const layer of entry?.layers ?? []) if (layer) layer.view = null;
      if (!entry) sets.set(set, { link, layers: [] });
    },
    /** The row the map last showed in the grid, once: the grid puts its cursor there. */
    take(/** @type {ResultSet | undefined} */ set) {
      if (!set) return undefined;
      const row = gotos.get(set);
      gotos.delete(set);
      return row;
    },
  };
}
