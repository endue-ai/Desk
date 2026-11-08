// Shape geometry: the preset shapes it draws (with their adjust values) and custom paths, as SVG
// path data in a box of w x h points, plus the ends of open paths for arrow heads. No DOM.

/**
 * @typedef {import("./deck.js").Geometry} Geometry
 * @typedef {import("./deck.js").PathCommand} PathCommand
 * @typedef {{ x: number, y: number, dx: number, dy: number }} End  A point and the direction the
 *   path leaves it in (start) or arrives in (end).
 * @typedef {{ d: string, fill: boolean, stroke: boolean, start?: End, end?: End }} Drawn
 */

const DRAWN = new Set([
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "rtTriangle",
  "diamond",
  "parallelogram",
  "trapezoid",
  "pentagon",
  "homePlate",
  "hexagon",
  "octagon",
  "chevron",
  "rightArrow",
  "leftArrow",
  "upArrow",
  "downArrow",
  "line",
  "bentConnector2",
  "bentConnector3",
  "curvedConnector3",
  "custom",
]);

const ALIASES = /** @type {Record<string, string>} */ ({
  straightConnector1: "line",
  lineInv: "line",
  bentConnector4: "bentConnector3",
  bentConnector5: "bentConnector3",
  curvedConnector2: "curvedConnector3",
  curvedConnector4: "curvedConnector3",
  curvedConnector5: "curvedConnector3",
  flowChartProcess: "rect",
  flowChartAlternateProcess: "roundRect",
  flowChartDecision: "diamond",
  flowChartConnector: "ellipse",
  flowChartTerminator: "roundRect",
  round2SameRect: "roundRect",
});

/** A preset's name as drawn: itself, an alias, or rect for one it does not draw. */
export const presetName = (/** @type {string} */ name) => {
  const known = ALIASES[name] ?? name;
  return DRAWN.has(known) ? known : "rect";
};

const n = (/** @type {number} */ v) => Math.round(v * 100) / 100;
/** @param {number[][]} points */
const poly = (points) => `M${points.map(([x, y]) => `${n(x ?? 0)},${n(y ?? 0)}`).join(" L")} Z`;

/**
 * SVG path data for a geometry in a w x h box.
 * @param {Geometry} geometry
 * @param {number} w
 * @param {number} h
 * @returns {Drawn[]}
 */
export function drawGeometry(geometry, w, h) {
  const a = (/** @type {string} */ name, /** @type {number} */ fallback) =>
    (geometry.adjust[name] ?? fallback) / 100000;
  const ss = Math.min(w, h);
  const closed = (/** @type {string} */ d) => [{ d, fill: true, stroke: true }];
  /** @param {number[][]} points @returns {Drawn[]} */
  const open = (points) => {
    const [first = [0, 0], second = [w, h]] = points;
    const last = points.at(-1) ?? second;
    const before = points.at(-2) ?? first;
    return [
      {
        d: `M${points.map(([x, y]) => `${n(x ?? 0)},${n(y ?? 0)}`).join(" L")}`,
        fill: false,
        stroke: true,
        start: end(first, second, true),
        end: end(last, before, false),
      },
    ];
  };
  switch (geometry.name) {
    case "roundRect": {
      const r = Math.min(ss * a("adj", 16667), w / 2, h / 2);
      return closed(
        `M${n(r)},0 H${n(w - r)} A${n(r)},${n(r)} 0 0 1 ${n(w)},${n(r)} V${n(h - r)} A${n(r)},${n(r)} 0 0 1 ${n(w - r)},${n(h)} H${n(r)} A${n(r)},${n(r)} 0 0 1 0,${n(h - r)} V${n(r)} A${n(r)},${n(r)} 0 0 1 ${n(r)},0 Z`,
      );
    }
    case "ellipse":
      return closed(
        `M0,${n(h / 2)} A${n(w / 2)},${n(h / 2)} 0 1 1 ${n(w)},${n(h / 2)} A${n(w / 2)},${n(h / 2)} 0 1 1 0,${n(h / 2)} Z`,
      );
    case "triangle":
      return closed(
        poly([
          [w * a("adj", 50000), 0],
          [w, h],
          [0, h],
        ]),
      );
    case "rtTriangle":
      return closed(
        poly([
          [0, 0],
          [w, h],
          [0, h],
        ]),
      );
    case "diamond":
      return closed(
        poly([
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ]),
      );
    case "parallelogram": {
      const x = ss * a("adj", 25000);
      return closed(
        poly([
          [x, 0],
          [w, 0],
          [w - x, h],
          [0, h],
        ]),
      );
    }
    case "trapezoid": {
      const x = ss * a("adj", 25000);
      return closed(
        poly([
          [0, h],
          [x, 0],
          [w - x, 0],
          [w, h],
        ]),
      );
    }
    case "pentagon":
      return closed(
        poly([
          [w / 2, 0],
          [w, h * 0.382],
          [w * 0.809, h],
          [w * 0.191, h],
          [0, h * 0.382],
        ]),
      );
    case "homePlate": {
      const x = w - ss * a("adj", 50000);
      return closed(
        poly([
          [0, 0],
          [x, 0],
          [w, h / 2],
          [x, h],
          [0, h],
        ]),
      );
    }
    case "hexagon": {
      const x = ss * a("adj", 25000);
      return closed(
        poly([
          [0, h / 2],
          [x, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [x, h],
        ]),
      );
    }
    case "octagon": {
      const x = ss * a("adj", 29289);
      return closed(
        poly([
          [x, 0],
          [w - x, 0],
          [w, x],
          [w, h - x],
          [w - x, h],
          [x, h],
          [0, h - x],
          [0, x],
        ]),
      );
    }
    case "chevron": {
      const x = ss * a("adj", 50000);
      return closed(
        poly([
          [0, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [0, h],
          [x, h / 2],
        ]),
      );
    }
    case "rightArrow":
    case "leftArrow": {
      const t = (h * a("adj1", 50000)) / 2;
      const x = w - ss * a("adj2", 50000);
      const pts = [
        [0, h / 2 - t],
        [x, h / 2 - t],
        [x, 0],
        [w, h / 2],
        [x, h],
        [x, h / 2 + t],
        [0, h / 2 + t],
      ];
      return closed(
        poly(geometry.name === "leftArrow" ? pts.map(([px, py]) => [w - (px ?? 0), py ?? 0]) : pts),
      );
    }
    case "upArrow":
    case "downArrow": {
      const t = (w * a("adj1", 50000)) / 2;
      const y = ss * a("adj2", 50000);
      const pts = [
        [w / 2 - t, h],
        [w / 2 - t, y],
        [0, y],
        [w / 2, 0],
        [w, y],
        [w / 2 + t, y],
        [w / 2 + t, h],
      ];
      return closed(
        poly(geometry.name === "downArrow" ? pts.map(([px, py]) => [px ?? 0, h - (py ?? 0)]) : pts),
      );
    }
    case "line":
      return open([
        [0, 0],
        [w, h],
      ]);
    case "bentConnector2":
      return open([
        [0, 0],
        [w, 0],
        [w, h],
      ]);
    case "bentConnector3": {
      const x = w * a("adj1", 50000);
      return open([
        [0, 0],
        [x, 0],
        [x, h],
        [w, h],
      ]);
    }
    case "curvedConnector3": {
      const [line] = open([
        [0, 0],
        [w, h],
      ]);
      if (!line) return [];
      return [
        {
          ...line,
          d: `M0,0 C${n(w / 2)},0 ${n(w / 2)},${n(h)} ${n(w)},${n(h)}`,
          start: end([0, 0], [1, 0], true),
          end: end([w, h], [w - 1, h], false),
        },
      ];
    }
    case "custom":
      return customPaths(geometry, w, h);
    default:
      return closed(`M0,0 H${n(w)} V${n(h)} H0 Z`);
  }
}

/** @param {number[]} at @param {number[]} toward @param {boolean} leaving @returns {End} */
function end(at, toward, leaving) {
  const [x = 0, y = 0] = at;
  const [tx = 0, ty = 0] = toward;
  const dx = leaving ? x - tx : x - tx;
  const dy = leaving ? y - ty : y - ty;
  const len = Math.hypot(dx, dy) || 1;
  return { x, y, dx: dx / len, dy: dy / len };
}

/** @param {Geometry} geometry @param {number} w @param {number} h @returns {Drawn[]} */
function customPaths(geometry, w, h) {
  return (geometry.paths ?? []).map((p) => {
    const sx = p.w ? w / p.w : 1;
    const sy = p.h ? h / p.h : 1;
    /** @type {number[][]} */
    const points = [];
    const d = p.commands
      .map((c) => {
        if (c.cmd === "Z") return "Z";
        if (c.cmd === "C") {
          points.push([c.x2 * sx, c.y2 * sy], [c.x * sx, c.y * sy]);
          return `C${n(c.x1 * sx)},${n(c.y1 * sy)} ${n(c.x2 * sx)},${n(c.y2 * sy)} ${n(c.x * sx)},${n(c.y * sy)}`;
        }
        points.push([c.x * sx, c.y * sy]);
        return `${c.cmd}${n(c.x * sx)},${n(c.y * sy)}`;
      })
      .join(" ");
    const isOpen = !p.commands.some((c) => c.cmd === "Z");
    /** @type {Drawn} */
    const drawn = { d, fill: p.fill && !isOpen, stroke: p.stroke };
    if (isOpen && points.length >= 2) {
      drawn.start = end(points[0] ?? [0, 0], points[1] ?? [0, 0], true);
      drawn.end = end(points.at(-1) ?? [0, 0], points.at(-2) ?? [0, 0], false);
    }
    return drawn;
  });
}

/**
 * The polygon of an arrow head at a line's end, for a line of the given width.
 * @param {End} at
 * @param {string} kind
 * @param {number} width
 */
export function arrowHead(at, kind, width) {
  const size = Math.max(3 * width, 6);
  const { x, y, dx, dy } = at;
  const px = -dy;
  const py = dx;
  const back = (/** @type {number} */ k) => [x - dx * size * k, y - dy * size * k];
  const [bx = 0, by = 0] = back(1);
  if (kind === "oval" || kind === "diamond") {
    const [mx = 0, my = 0] = back(0.5);
    const r = size / 2;
    return poly([
      [x, y],
      [mx + px * r, my + py * r],
      [bx, by],
      [mx - px * r, my - py * r],
    ]);
  }
  const half = size / 2;
  const tip = [x, y];
  const left = [bx + px * half, by + py * half];
  const right = [bx - px * half, by - py * half];
  if (kind === "stealth") return poly([tip, left, back(0.6), right]);
  return poly([tip, left, right]);
}
