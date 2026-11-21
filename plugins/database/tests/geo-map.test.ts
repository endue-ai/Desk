// @vitest-environment jsdom
// The Map tab and the value viewer's Shape on jsdom (PG-46, ui/geo/map-view.js, value-shape.js),
// with the map's engine answering in the frame as it does without a worker; and the viewer's own
// statement (features/geo/) through the plugin on the scripted PostgreSQL server.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultSet } from "../ui/engines/common.js";
import { spatialColumns } from "../ui/geo/detect.js";
import { createEngine } from "../ui/geo/engine.js";
import { createGrid } from "../ui/view-grid.js";
import { createValueViewer } from "../ui/view-value.js";
import { CAPTURED, CURVE_AS_LINE } from "./geo-corpus";
import { mount, SAVED } from "./harness";

const hex = (name: string) => CAPTURED.find((c) => c.name === name)?.hex ?? "";
const html = readFileSync("plugins/database/ui/index.html", "utf8");
type Act = [string, ...unknown[]];

const SET: ResultSet = {
  columns: ["id", "name", "geom"],
  rows: [
    ["1", "north", hex("polygon with a hole")],
    ["2", "path", hex("line")],
    ["3", "nothing", null],
    ["4", "well", hex("point")],
    ["5", "arc", hex("circular string")],
  ],
  truncated: false,
  types: [23, 25, 16394],
};
const rowsTab = { label: "Result", kind: "rows" as const, statement: 0, set: SET };
const mapTab = {
  label: "Map",
  kind: "map" as const,
  statement: 0,
  geo: { set: SET, columns: spatialColumns(SET) },
};
const context = { edit: null, server: false, key: "result:c-prod:1:0" };

/** A worker starter whose worker runs the map's engine a message at a time, as a thread would. */
function fakeWorker() {
  const started: Array<{ url: URL; name: string | undefined }> = [];
  const asked: Array<{ op: string }> = [];
  const startWorker = (url: URL, options?: { name?: string }) => {
    started.push({ url, name: options?.name });
    const engine = createEngine();
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      terminate: () => {},
      postMessage: (request: { op: string }) => {
        asked.push(structuredClone(request));
        const { reply } = engine.answer(
          structuredClone(request) as Parameters<typeof engine.answer>[0],
        );
        setTimeout(() => worker.onmessage?.({ data: reply }), 0);
      },
    };
    return worker as unknown as Worker;
  };
  return { startWorker, started, asked };
}
const box = () => document.querySelector<HTMLElement>(".geo-box") as HTMLElement;
const said = () => document.querySelector(".geo-said")?.textContent ?? "";
const press = (target: Element, key: string, options: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));

describe("the Map tab", () => {
  let acts: Act[];
  beforeEach(() => {
    document.body.innerHTML = `<div id="results"><div id="result"></div></div><p id="hints"></p>`;
    acts = [];
    // jsdom draws nothing: the engine counts what a view holds, as it does with no canvas.
    HTMLCanvasElement.prototype.getContext = () => null;
  });

  it("the Map tab draws through its worker and is linked to the grid both ways", async () => {
    const host = document.getElementById("result") as HTMLElement;
    const { startWorker, started, asked } = fakeWorker();
    const grid = createGrid(
      document,
      host,
      (action, ...args) => {
        acts.push([action, ...args]);
        // The viewer's own statement, answered as the server reads a curve.
        return action === "geoRead" ? [CURVE_AS_LINE.geojson] : undefined;
      },
      { startWorker },
    );
    grid.render(rowsTab, true, context);
    const cells = host.querySelector("[role=grid]") as HTMLElement;
    press(cells, "ArrowDown", { shiftKey: true });
    // The grid's block covers rows 1 and 2: the map opens on them, its cursor's row picked.
    grid.render(mapTab, true, { ...context, key: "result:c-prod:1:1" });
    await vi.waitFor(() => expect(box().dataset.shapes).toBe("2"));
    const tabs = [...document.querySelectorAll<HTMLElement>(".geo-rows [role=tab]")];
    expect(tabs.map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([
      ["All rows (5)", "false"],
      ["Selected rows (2)", "true"],
    ]);
    await vi.waitFor(() =>
      expect(said()).toBe("Row 2 · id 2 · name path · LineString · 3 vertices"),
    );
    const canvas = document.querySelector(".geo-canvas") as HTMLCanvasElement;
    expect(canvas.getAttribute("aria-label")).toBe(
      "Map of geom: 1 Polygon, 2 LineString, 1 Point, SRID 4326",
    );
    // One worker for the page, that read, drew and picked; the frame only blits.
    expect(started.map((w) => [w.url.pathname.endsWith("/ui/geo/worker.js"), w.name])).toEqual([
      [true, "Database map"],
    ]);
    expect(new Set(asked.map((r) => r.op))).toEqual(
      new Set(["load", "read", "bounds", "draw", "facts"]),
    );
    // The curve was read by the viewer's own statement, with only its value.
    expect(acts.filter((a) => a[0] === "geoRead")).toEqual([["geoRead", [hex("circular string")]]]);
    expect(document.querySelector(".geo-scale-text")?.textContent).toMatch(/^\d+ (m|km)$/u);

    tabs[0]?.click();
    await vi.waitFor(() => expect(box().dataset.shapes).toBe("4"));
    press(canvas, "n");
    await vi.waitFor(() => expect(said()).toBe("Row 4 · id 4 · name well · Point · 1 vertex"));
    canvas.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.getElementById("hints")?.textContent).toMatch(/N and P pick a row/u);
    press(canvas, "Enter");
    expect(acts.at(-1)).toEqual(["showSet", SET]);
    // Back in the grid, the cursor is on the row the map showed.
    grid.render(rowsTab, true, context);
    expect(grid.cursorCell()?.row).toBe(3);
  });

  it("the value viewer shows one geometry with its type, SRID and vertex count", async () => {
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    const viewer = createValueViewer(
      document,
      () => undefined,
      async () => true,
      () => {},
    );
    const cell = { row: 0, col: 2, name: "geom", type: "", editable: false, reason: "" };
    viewer.open({ ...cell, value: hex("polygon with a hole"), oid: 16394 });
    const tabs = () =>
      [...document.querySelectorAll("#value-tabs [role=tab]")].map((t) => t.textContent);
    expect(tabs()).toEqual(["Shape", "Text"]);
    const meta = () => document.getElementById("value-meta")?.textContent ?? "";
    await vi.waitFor(() => expect(meta()).toMatch(/^Polygon · SRID 4326 · 10 vertices · /u));
    expect((document.getElementById("value-text") as HTMLElement).hidden).toBe(true);
    expect(document.querySelector(".value-shape canvas")?.getAttribute("aria-label")).toBe(
      "Polygon · SRID 4326 · 10 vertices",
    );
    (document.querySelector('#value-tabs [data-view="text"]') as HTMLElement).click();
    expect((document.getElementById("value-text") as HTMLTextAreaElement).value).toBe(
      hex("polygon with a hole"),
    );
    expect((document.querySelector(".value-shape") as HTMLElement).hidden).toBe(true);

    viewer.open({ ...cell, value: "(3,4),(0,0)", oid: 603 });
    await vi.waitFor(() => expect(meta()).toMatch(/^box · no SRID · 2 vertices/u));
    viewer.open({ ...cell, value: "<(1,2),3>", type: "circle" });
    await vi.waitFor(() => expect(meta()).toMatch(/^circle · no SRID · 1 vertex · radius 3/u));
    viewer.open({ ...cell, value: "plain words", oid: 25 });
    expect((document.getElementById("value-tabs") as HTMLElement).hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".value-shape")?.hidden).toBe(true);
  });
});

describe("the viewer's own statement", () => {
  const PERSON = "select id, geom from arcs";
  const script = (sql: string) => {
    if (sql === PERSON)
      return {
        rows: [
          ["id", "geom"],
          ["1", hex("circular string")],
          ["2", hex("point")],
        ],
        types: [23, 16394],
      };
    if (sql.startsWith("SELECT ST_AsGeoJSON(ST_CurveToLine("))
      return { rows: [["st_asgeojson"], [CURVE_AS_LINE.geojson]] };
    return {};
  };

  it("a value the reader cannot draw is read as GeoJSON in the viewer's own statement, never the person's", async () => {
    const m = await mount({ store: { connections: SAVED }, script });
    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text = PERSON;
    await m.host.command("endue.database.run");
    const shown = m.shown();
    expect(shown?.shown?.tabs.map((t) => t.label)).toEqual(["Result", "Map", "Messages"]);
    const texts = await m.app.geoRead?.([hex("circular string")]);
    expect(texts).toEqual([CURVE_AS_LINE.geojson]);
    const sent = m.sessions().flat();
    expect(sent.filter((s) => s === PERSON)).toHaveLength(1);
    expect(sent.at(-1)).toBe(
      `SELECT ST_AsGeoJSON(ST_CurveToLine(t.v::geometry)) FROM unnest(ARRAY['${hex("circular string")}']::text[]) WITH ORDINALITY AS t(v, n) ORDER BY t.n`,
    );
    // The person's result stays as it came: its rows, its tabs.
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toHaveLength(2);
    // Only hex goes into the statement; anything else is refused before the server is asked.
    const before = m.sessions().flat().length;
    expect(await m.app.geoRead?.(["'); drop table arcs; --"])).toBeUndefined();
    expect(m.sessions().flat()).toHaveLength(before);
    expect(m.view.said.at(-1)).toMatch(/only EWKB values/u);

    await m.host.command("endue.database.show-map");
    expect(m.shown()?.tab).toBe(1);
  });
});
