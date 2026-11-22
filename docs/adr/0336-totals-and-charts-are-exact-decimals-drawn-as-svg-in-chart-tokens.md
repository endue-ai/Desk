---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Totals and charts are counted on exact decimal text and drawn as SVG in the chart tokens

## Context and Problem Statement

PG-44 (#471) asks that `endue.database` show a grid selection's count, distinct count, sum, average,
minimum and maximum in the footer, computed on exact decimal text, and draw a result as a chart (bar, line,
area, scatter, pie, with series and an aggregation) in the theme's chart tokens, readable in both themes, with
a table for screen readers, exported as an image, its settings kept with a starred query. Results reach
100,000 rows and the frame's thread must stay free. How are numbers added, where is a large selection
counted, how is a chart drawn, which colours does it use, and where are its settings kept?

## Decision Drivers

* A sum or average never differs from the server's because of floating point (bigint past 2^53, 0.1 + 0.2)
* Counting a large selection or a large result never holds the frame's thread
* A theme change reaches the chart, and every mark reaches 3:1 on every neutral surface in both schemes
* What is kept fits the plugin's store and survives a result whose columns moved

## Considered Options

* BigInt digits and a scale per value, counted in a worker past 20,000 cells; SVG built as text from tokens
* Numbers as floats, with a rounding note
* Aggregates asked of the server (`SELECT sum(...) FROM (query)`)
* A canvas drawn in the worker

## Decision Outcome

Chosen option: "BigInt digits and a scale per value", because it is exact for every text PostgreSQL prints
(numeric of any size, bigint, double precision as printed, NaN and the infinities in the server's order),
costs no statement, and runs the same in the frame and in the chart's worker (`ui/chart/worker.js`), which
counts a selection or a chart over more than 20,000 cells with each column sent once per result. The sum
keeps the values' largest scale as `sum(numeric)` does; the average is the exact sum divided by the count,
rounded half away from zero to six places past that scale, trailing zeros dropped.

A chart is an SVG document built as text (`ui/chart/draw.js`) and parsed into the page, so the export writes
the same document with the tokens resolved to colours and a PNG is drawn from it. Its series use the chart
tokens that reach 3:1 on every neutral surface in both schemes: `--desk-chart-1`, `-4`, `-5`, `-6`, `-8`,
`-10` (`-2`, `-3`, `-7` and `-9` fall under it on one of them). The colours are SVG attributes holding
`var(--desk-chart-N)`, not stylesheet `fill` rules, which the contrast test would hold to text's 4.5:1.

Chart settings are kept by column name in the store under `charts:<connection>`, one entry per starred query
(its name and SQL); an entry whose query was unstarred or changed is dropped on the next write, and kept
settings whose columns are gone fall back to the result's defaults.

### Consequences

* Good, because totals and charts say exactly what the server would, at any size of number.
* Good, because the frame only draws: counting a large block or result happens in the worker.
* Neutral, because an average rounds at six places past the values' scale, said in the notes.
* Bad, because BigInt arithmetic is slower than floats; past 20,000 cells it runs in the worker.
* Bad, because a chart draws at most 50 bars, 6 series, 6 slices and 5,000 dots; it says what it left out.

## Pros and Cons of the Options

### Floats with a rounding note

* Good, because it is fast and simple.
* Bad, because a bigint past 2^53 and a money column's sum come out wrong, which the Requirement rules out.

### Aggregates asked of the server

* Good, because the server's own arithmetic is the reference.
* Bad, because it runs the query again (a write, a slow query, a different snapshot) and a selection of
  sorted, filtered or edited rows has no statement of its own.

### A canvas drawn in the worker

* Good, because a large scatter draws without the DOM.
* Bad, because a picture gives a screen reader nothing and the theme's tokens would be read by hand; the
  marks a chart draws are few enough for SVG.
