// The commit graph's layout: each commit gets a lane and a colour, and each row the segments that
// cross it, so a row draws itself without its neighbours (and the graph view only draws the rows on
// screen). Lanes stay where they are while they live; a first parent keeps its child's lane, so a
// branch's line is straight, and a freed lane is reused by the next branch that needs one.

/**
 * @typedef {{ sha: string, parents: string[] }} Node
 * @typedef {"pass" | "in" | "out"} SegmentKind
 *   pass: top to bottom in one lane; in: from a lane at the top into the node; out: from the node
 *   down to a lane at the bottom.
 * @typedef {{ kind: SegmentKind, from: number, to: number, color: number }} Segment
 * @typedef {{ lane: number, color: number, segments: Segment[], merge: boolean, width: number }} Row
 * @typedef {{ sha: string, color: number }} Lane
 */

/** How many colours the lanes cycle through (the theme's chart-1 … chart-8). */
export const COLORS = 8;

/**
 * @param {Node[]} nodes newest first, every child before its parents (git log --date-order)
 * @returns {{ rows: Row[], width: number }}
 */
export function layoutGraph(nodes) {
  /** @type {(Lane | null)[]} */
  const lanes = [];
  let nextColor = 0;
  let width = 0;
  /** @type {Row[]} */
  const rows = [];
  const free = (/** @type {number} */ except) => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null && i !== except) return i;
    return Math.max(lanes.length, except + 1);
  };

  for (const node of nodes) {
    let lane = lanes.findIndex((slot) => slot?.sha === node.sha);
    /** @type {number} */
    let color;
    if (lane < 0) {
      lane = free(-1);
      color = nextColor++ % COLORS;
    } else color = /** @type {Lane} */ (lanes[lane]).color;

    /** @type {Segment[]} */
    const segments = [];
    for (let i = 0; i < lanes.length; i++) {
      const slot = lanes[i];
      if (!slot) continue;
      if (slot.sha === node.sha) {
        segments.push({ kind: "in", from: i, to: lane, color: slot.color });
        lanes[i] = null;
      } else segments.push({ kind: "pass", from: i, to: i, color: slot.color });
    }

    const [first, ...others] = node.parents;
    if (first !== undefined) {
      const existing = lanes.findIndex((slot) => slot?.sha === first);
      if (existing >= 0 && existing < lane) {
        segments.push({ kind: "out", from: lane, to: existing, color });
      } else {
        lanes[lane] = { sha: first, color };
        segments.push({ kind: "out", from: lane, to: lane, color });
      }
    }
    for (const parent of others) {
      const existing = lanes.findIndex((slot) => slot?.sha === parent);
      if (existing >= 0) {
        segments.push({
          kind: "out",
          from: lane,
          to: existing,
          color: /** @type {Lane} */ (lanes[existing]).color,
        });
        continue;
      }
      const at = free(lane);
      const parentColor = nextColor++ % COLORS;
      lanes[at] = { sha: parent, color: parentColor };
      segments.push({ kind: "out", from: lane, to: at, color: parentColor });
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    let rowWidth = lane + 1;
    for (const segment of segments) rowWidth = Math.max(rowWidth, segment.from + 1, segment.to + 1);
    width = Math.max(width, rowWidth);
    rows.push({ lane, color, segments, merge: node.parents.length > 1, width: rowWidth });
  }
  return { rows, width };
}

/**
 * The SVG path of one segment in a row `height` tall, lanes `laneWidth` apart, `pad` from the left.
 * @param {Segment} segment
 * @param {{ height: number, laneWidth: number, pad: number }} size
 */
export function segmentPath(segment, { height, laneWidth, pad }) {
  const x = (/** @type {number} */ lane) => pad + lane * laneWidth + laneWidth / 2;
  const mid = height / 2;
  const a = x(segment.from);
  const b = x(segment.to);
  if (segment.kind === "pass") return `M${a} 0V${height}`;
  if (segment.kind === "in") {
    if (a === b) return `M${a} 0V${mid}`;
    return `M${a} 0C${a} ${mid * 0.9} ${b} ${mid * 0.4} ${b} ${mid}`;
  }
  if (a === b) return `M${a} ${mid}V${height}`;
  return `M${a} ${mid}C${a} ${mid + mid * 0.6} ${b} ${mid + mid * 0.1} ${b} ${height}`;
}
