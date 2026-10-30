// The log view's rows: a graph cell drawn from the lanes `layoutGraph` computed, the short sha, the
// refs as badges, the subject, the author and when. The last row offers more when there is more.

import { el, row, span } from "./dom.js";
import { laneCount, relativeTime } from "./parse-log.js";

/**
 * @typedef {import("./git.js").LogView} LogView
 * @typedef {import("./parse-log.js").Row} GraphRow
 * @typedef {import("./dom.js").RowSpec} RowSpec
 */

const LANE_WIDTH = 12;
const ROW_HEIGHT = 22;
const DOT = 3.5;
const COLOURS = 8;
const SVG = "http://www.w3.org/2000/svg";

/**
 * @param {Document} doc
 * @param {LogView} model
 * @param {number} [now]
 * @returns {RowSpec[]}
 */
export function renderLog(doc, model, now = Date.now()) {
  const lanes = laneCount(model.rows);
  const rows = model.commits.map((commit, index) => {
    const graph = model.rows[index];
    return row(doc, "commit", { kind: "commit", sha: commit.sha }, 1, [
      graph ? graphSvg(doc, graph, lanes) : undefined,
      span(doc, "sha", commit.sha.slice(0, 7)),
      el(
        doc,
        "span",
        { class: "refs" },
        ...commit.refs.map((ref) =>
          span(doc, `ref ${ref.kind}${ref.current ? " current" : ""}`, ref.name),
        ),
      ),
      span(doc, "subject", commit.subject),
      span(doc, "meta", `${commit.author} · ${relativeTime(commit.date, now)}`),
    ]);
  });
  if (model.more) {
    rows.push(row(doc, "more", undefined, 1, [span(doc, "subject", "More commits (press +)")]));
  }
  if (rows.length === 0) rows.push(row(doc, "empty", undefined, 1, ["No commits yet."]));
  return rows;
}

/**
 * One row of the graph: lanes passing through, those curving into the dot from above, and the
 * parents fanning out below. Lane i is drawn at x = i * LANE_WIDTH + LANE_WIDTH / 2.
 * @param {Document} doc
 * @param {GraphRow} graph
 * @param {number} lanes
 */
export function graphSvg(doc, graph, lanes) {
  const width = lanes * LANE_WIDTH;
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "graph");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(ROW_HEIGHT));
  svg.setAttribute("viewBox", `0 0 ${width} ${ROW_HEIGHT}`);
  svg.setAttribute("aria-hidden", "true");
  const x = (/** @type {number} */ lane) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  const mid = ROW_HEIGHT / 2;
  const path = (/** @type {string} */ d, /** @type {number} */ lane) => {
    const node = doc.createElementNS(SVG, "path");
    node.setAttribute("d", d);
    node.setAttribute("class", `lane lane-${lane % COLOURS}`);
    svg.append(node);
  };
  const curve = (
    /** @type {number} */ from,
    /** @type {number} */ to,
    /** @type {number} */ y0,
    /** @type {number} */ y1,
    /** @type {number} */ colour,
  ) => {
    const ym = (y0 + y1) / 2;
    path(`M ${x(from)} ${y0} C ${x(from)} ${ym}, ${x(to)} ${ym}, ${x(to)} ${y1}`, colour);
  };
  graph.before.forEach((waiting, lane) => {
    if (waiting === null) return;
    if (waiting === graph.sha) curve(lane, graph.lane, 0, mid, graph.lane);
    else path(`M ${x(lane)} 0 V ${mid}`, lane);
  });
  for (const join of graph.joins) curve(join.from, join.to, mid, ROW_HEIGHT, join.from);
  graph.after.forEach((waiting, lane) => {
    if (waiting === null) return;
    const passes = graph.before[lane] !== null && graph.before[lane] !== undefined;
    const passing = passes && graph.before[lane] !== graph.sha && lane !== graph.lane;
    if (passing) path(`M ${x(lane)} ${mid} V ${ROW_HEIGHT}`, lane);
    if (graph.parentLanes.includes(lane)) curve(graph.lane, lane, mid, ROW_HEIGHT, lane);
  });
  const dot = doc.createElementNS(SVG, "circle");
  dot.setAttribute("cx", String(x(graph.lane)));
  dot.setAttribute("cy", String(mid));
  dot.setAttribute("r", String(DOT));
  dot.setAttribute("class", `dot lane-${graph.lane % COLOURS}`);
  svg.append(dot);
  return svg;
}
