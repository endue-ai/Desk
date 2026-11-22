# The Database plugin's map

What the plugin draws of a result's spatial values. The rest of the plugin is in
[`features.md`](features.md); a change to the map adds its line here.

## The Map tab

- A result with a spatial column gets a Map tab after its rows ("Map", or "Map 2" after the second set's
  rows), and Database: show the result on a map opens it. A column is spatial by its type when it is one of
  PostgreSQL's point, lseg, path, box, polygon and circle (line is infinite and is not drawn), else by its
  first 16 values that are not NULL, all of one kind: the EWKB hex a server prints for geometry and
  geography, WKT or EWKT, or GeoJSON. bytea, plain text and a column that mixes kinds get none. One column
  is drawn at a time; a set with more has a picker.
- The shapes are drawn on the plugin's own canvas in their coordinates (ADR 0325): no tiles, nothing
  fetched, no permission. A graticule and a scale bar take round steps in the SRID's units: degrees for
  4326, 4269 and 4258 (x narrowed at the view's latitude), metres for 3857 and the UTM zones, else units.
- The plugin's worker reads the values, simplifies each shape to the pixel, leaves out what is out of view
  and draws the view to a bitmap; the frame only shows it, so twenty thousand shapes zoom and pan smoothly.
- Rows are coloured by their number from the desk's chart colours; the picked row is drawn last in the
  desk's ink. A note says how many values could not be read, and when the shapes are in more than one SRID.

## Moving and picking

- Drag or the arrows pan, the wheel zooms about the pointer and `+` `-` about the middle, `0` and Fit show
  every shape. With the map focused, the hint line names its keys.
- A click picks the shape under the pointer (the last drawn wins); `n` and `p` step through the shapes.
  The status line says the row's number, up to three of its other values, the shape's type and vertices;
  Enter, a double click or Show in grid moves the grid's cursor to that row. Escape lets the pick go.
- The grid's selected block opens the map on those rows alone (Selected rows), its cursor's row picked;
  All rows shows the whole set again.

## Values

- EWKB in either byte order, with its SRID, Z and M; ISO WKB; WKT and EWKT; GeoJSON (its `crs` name, else
  SRID 4326). A vertex counts as the server's ST_NPoints counts it, a ring's closing point included; a
  circle is its centre and radius, drawn as 64 sides.
- A curve (circular string, compound curve, curve polygon, multicurve, multisurface) is read back as a line
  by the plugin's own statement on the console's connection, over the values as literals with only hex let
  in, never by changing or running the person's statement again; it asks nothing and goes into no history.
- The value viewer (`v`) opens a spatial value on its Shape view: the shape drawn fitted, with its type,
  SRID and vertex count (and a circle's radius); Text shows the value as the server wrote it, and Copy
  copies that.
- MySQL and SQLite values are drawn when the statement returns them as WKT or GeoJSON text.

Modules: `geo/`, `features/geo/`, `tabs.js`, `view-grid.js`, `view-value.js`.
