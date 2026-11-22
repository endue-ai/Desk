// Shapes on a map (PG-46): Database: show the result on a map opens the Map tab of the result on
// screen (tabs.js adds one after each set with a column of shapes; geo/map-view.js draws it), and
// the viewer's own statement, the `geoRead` action: the curves the map's reader does not draw
// (EWKB hex of a circular string, a curve polygon...) read back as GeoJSON lines on the server,
// over the values as literals and never by changing or running again the person's statement. It
// is the plugin's own read: it asks nothing and goes into no history. No DOM.

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 */

const HEX = /^[0-9A-Fa-f]+$/u;

/** The statement that reads EWKB hex values back as GeoJSON, curves made lines, in their order. */
export function readSql(/** @type {string[]} */ values) {
  const list = values.map((v) => `'${v}'`).join(", ");
  return (
    "SELECT ST_AsGeoJSON(ST_CurveToLine(t.v::geometry)) " +
    `FROM unnest(ARRAY[${list}]::text[]) WITH ORDINALITY AS t(v, n) ORDER BY t.n`
  );
}

/** Read hex values as GeoJSON on the connection of the console on screen; null for a value it gave none. */
async function geoRead(/** @type {Deps} */ deps, /** @type {unknown} */ values) {
  const list = Array.isArray(values) ? values : [];
  const shown = deps.consoles.current();
  const conn = shown ? deps.manager.get(shown.connection) : undefined;
  if (conn?.engine !== "postgresql" || list.length === 0) return undefined;
  if (!list.every((v) => typeof v === "string" && HEX.test(v)))
    throw new Error("Map: only EWKB values are read on the server.");
  const run = await deps.execute(conn, readSql(/** @type {string[]} */ (list)), {
    catalog: true,
    maxRows: list.length,
  });
  const statement = run.result.statements[0];
  const error = run.result.error ?? statement?.error;
  if (error) throw new Error(`Map: the server did not read the curves: ${error.message}`);
  const rows = statement?.sets[0]?.rows ?? [];
  return list.map((_, i) => rows[i]?.[0] ?? null);
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "geo",
  commands: (deps) => ({
    "endue.database.show-map": () => {
      const shown = deps.consoles.current();
      const tabs = shown?.shown?.tabs ?? [];
      const after = tabs.findIndex((t, i) => t.kind === "map" && i >= (shown?.tab ?? 0));
      const index = after >= 0 ? after : tabs.findIndex((t) => t.kind === "map");
      if (index < 0) throw new Error("No result on screen holds geometry or geography values.");
      deps.consoles.tab(index);
      return tabs[index]?.label;
    },
  }),
  actions: (deps) => ({
    geoRead: (/** @type {unknown} */ values) => geoRead(deps, values),
  }),
  styles: [new URL("./geo.css", import.meta.url).href],
};
