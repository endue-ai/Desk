---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Spatial values are drawn on the plugin's own canvas, in its worker

## Context and Problem Statement

PG-46 (#473) asks that geometry and geography values be seen on a map: a result with a spatial column
shows its shapes, and the value viewer shows one. A server with the spatial extension prints a geometry
or a geography as EWKB in hex, and its types have no fixed OID; PostgreSQL's own geometric types (point,
lseg, path, box, polygon, circle) print as text and have fixed OIDs; other columns may hold WKT, EWKT or
GeoJSON text. A result can hold tens of thousands of shapes, the plugin runs in a sandboxed frame whose
permissions are declared in its manifest, and the frame's thread must stay free for the grid and the
editor. What draws the shapes, over what, where are the values read, and how are values the plugin cannot
read itself (curves) shown without changing the person's statement?

## Decision Drivers

* No network: nothing fetched, no new permission, nothing about the data leaves the desk
* Thousands of shapes zoom and pan with the frame's longest task under 100 ms
* Every value read as the server wrote it, its SRID, Z and M kept, its vertex count the server's
* The person's statement is never changed or run again to read the shapes
* The map and the grid work as one: the rows chosen in one are the rows shown in the other

## Considered Options

* The shapes on the plugin's own canvas in their coordinates, read and drawn in the plugin's worker
* A web map over tiles from a tile server, the shapes as a layer on it
* The shapes as SVG in the frame's document

## Decision Outcome

Chosen option: "the plugin's own canvas, in its worker", because it needs no network or permission, it
draws any SRID as its coordinates are (a tile map knows one projection), and a worker that reads,
simplifies and draws keeps the frame's thread for the person. SVG would hold one element per shape in the
frame's document and slow the frame down at a few thousand.

* `tabs.js` adds a Map tab after the rows tab of each set with a spatial column ("Map", or "Map 2" after
  "2"). A column is spatial by its OID for the built-in types, else by its first 16 values that are not
  NULL, all of one kind: EWKB hex, WKT or EWKT, GeoJSON. bytea, plain text and a mix of kinds are not. One
  column is drawn at a time; a set with more has a column picker.
* `geo/` reads EWKB in either byte order, with the SRID, Z and M flags and ISO's 1000s, WKT and EWKT,
  GeoJSON (a `crs` name, else 4326) and the built-in types' text. A vertex counts as ST_NPoints counts
  it, a ring's closing point included; a circle is its centre and radius, drawn as 64 sides. A box is two.
* The worker (`geo/worker.js`, the SDK's `startWorker`) holds each column's shapes, simplifies each to
  its zoom level (radial distance, then Douglas-Peucker, half a pixel), culls by the view's box, buckets
  the shapes by colour into a few paths, and draws on an OffscreenCanvas to a bitmap it transfers. The
  frame only blits the last bitmap, moved and scaled while a gesture runs, one request in flight and the
  latest view asked next. Without a worker the same engine answers in the frame.
* The plane: SRID 4326, 4269 and 4258 are degrees, x narrowed by the cosine of the view's latitude;
  3857 is Web Mercator metres measured at the view's latitude; the UTM zones are metres; anything else is
  units. The graticule and the scale bar take round 1, 2, 5 steps.
* Rows are coloured by row number from the eight desk chart colours that reach 3:1 as marks on the
  plane in the light and dark schemes (1, 8, 5, 6, 4, 9, 7, 10: 2 and 3 do not on white); the picked
  row is drawn last in `--desk-primary`, the desk's ink. The grid's selected block opens the map on
  those rows alone (Selected rows), its cursor's row picked; a pick says the row's values and its shape,
  and Show in grid moves the grid's cursor to it.
* A curve (circular string, compound curve, curve polygon, multicurve, multisurface) is not read in the
  plugin. Its values go back to the server in the viewer's own statement, `ST_AsGeoJSON(ST_CurveToLine(
  v::geometry))` over an array of the values as literals, only hex let in, on the console's connection
  as the plugin's own read: nothing asked, no history.

### Consequences

* Good, because the map needs no permission, network or tile server, and works offline and on any SRID
* Good, because the parsing and drawing never run on the frame's thread: 20,000 shapes zoom and pan with
  a longest task near 30 ms in the runtime e2e
* Good, because the readers are held to the server's own counts, SRIDs and boxes in a live test
* Bad, because there is no base map: streets and coasts are not drawn under the shapes, and degrees are a
  plane, not a projection, so shapes far from the equator or over large areas look stretched
* Bad, because a curve needs a second statement on the server, and is not drawn when the server cannot
  read it (a note says how many)
* Bad, because MySQL and SQLite spatial values are drawn only when the statement returns them as WKT or
  GeoJSON text (`ST_AsText`, `ST_AsGeoJSON`); their binary forms are not read

### Confirmation

`plugins/database/tests/geo-readers.test.ts` (every reader against a corpus captured from a server),
`geo-tabs.test.ts` (which sets get a Map tab), `geo-draw.test.ts` (simplifying, culling, batching,
picking, the plane and the worker's requests), `geo-map.test.ts` (the Map tab and the value viewer on
jsdom, and the viewer's own statement through the plugin), `geo-live.test.ts` on a real PostgreSQL with
and without the spatial types, and `packages/runtime/e2e/database-geo.spec.ts` in the page, with its
timing of twenty thousand shapes.

## More Information

`plugins/database/ui/geo/` (`wkb.js`, `wkt.js`, `geojson.js`, `pg-geometric.js` the readers, `detect.js`
the columns, `layer.js`, `simplify.js`, `plane.js` and `draw.js` the engine's parts, `engine.js` and
`worker.js` the worker, `client.js`, `map-canvas.js`, `map-input.js`, `map-view.js` and `value-shape.js`
the frame's side) and `ui/features/geo/` (the command and the viewer's own statement). A plugin's workers
are ADR 0048's; the result grid is ADR 0288's.
