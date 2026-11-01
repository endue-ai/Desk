// XPS geometry as SVG path data: the abbreviated syntax (F0/F1, M L H V C Q S A Z and their
// relative forms, with implicit repeats) and PathGeometry elements (PathFigure with PolyLine,
// PolyBezier, PolyQuadraticBezier and Arc segments). Each segment gets its own command letter.

const ARGS = /** @type {Record<string, number>} */ ({
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  Q: 4,
  S: 4,
  A: 7,
  Z: 0,
});

const num = (/** @type {number} */ n) => String(Math.round(n * 1000) / 1000);

/** Numbers and pairs in an XPS list ("1,2 3,4"), as numbers. */
export const numbers = (/** @type {string | null | undefined} */ text) =>
  (text ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));

/**
 * @param {string} data The abbreviated syntax.
 * @returns {{ d: string, rule: "evenodd" | "nonzero" }}
 */
export function abbreviated(data) {
  let rule = /** @type {"evenodd" | "nonzero"} */ ("evenodd");
  const tokens = data.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out = [];
  let command = "";
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i] ?? "";
    if (/^[A-Za-z]$/.test(token)) {
      i++;
      if (token === "F") {
        rule = tokens[i] === "1" ? "nonzero" : "evenodd";
        i++;
        continue;
      }
      command = token;
      if (command.toUpperCase() === "Z") {
        out.push(command);
        continue;
      }
    }
    const upper = command.toUpperCase();
    const count = ARGS[upper];
    if (count === undefined || count === 0) {
      i++;
      continue;
    }
    const args = tokens.slice(i, i + count).map(Number);
    if (args.length < count || args.some(Number.isNaN)) break;
    out.push(`${command}${args.map(num).join(" ")}`);
    i += count;
    // After a move, further pairs are lines.
    if (upper === "M") command = command === "M" ? "L" : "l";
  }
  return { d: out.join(""), rule };
}

const pairs = (/** @type {number[]} */ list) => {
  const out = [];
  for (let i = 0; i + 1 < list.length; i += 2)
    out.push(`${num(list[i] ?? 0)} ${num(list[i + 1] ?? 0)}`);
  return out;
};

/**
 * A PathGeometry element: its Figures attribute or its PathFigure children.
 * @param {Element} geometry
 * @returns {{ d: string, rule: "evenodd" | "nonzero" }}
 */
export function pathGeometry(geometry) {
  const rule = geometry.getAttribute("FillRule") === "NonZero" ? "nonzero" : "evenodd";
  const figures = geometry.getAttribute("Figures");
  if (figures) {
    const parsed = abbreviated(figures);
    return { d: parsed.d, rule: /^\s*F/.test(figures) ? parsed.rule : rule };
  }
  const out = [];
  for (const figure of geometry.children) {
    if (figure.localName !== "PathFigure") continue;
    out.push(`M${pairs(numbers(figure.getAttribute("StartPoint")))[0] ?? "0 0"}`);
    for (const segment of figure.children) {
      const points = pairs(
        numbers(segment.getAttribute("Points") ?? segment.getAttribute("Point")),
      );
      switch (segment.localName) {
        case "PolyLineSegment":
          for (const p of points) out.push(`L${p}`);
          break;
        case "PolyBezierSegment":
          for (let i = 0; i + 2 < points.length; i += 3)
            out.push(`C${points.slice(i, i + 3).join(" ")}`);
          break;
        case "PolyQuadraticBezierSegment":
          for (let i = 0; i + 1 < points.length; i += 2)
            out.push(`Q${points.slice(i, i + 2).join(" ")}`);
          break;
        case "ArcSegment": {
          const [rx = 0, ry = 0] = numbers(segment.getAttribute("Size"));
          const large = segment.getAttribute("IsLargeArc") === "true" ? 1 : 0;
          const sweep = segment.getAttribute("SweepDirection") === "Clockwise" ? 1 : 0;
          out.push(
            `A${num(rx)} ${num(ry)} ${num(Number(segment.getAttribute("RotationAngle") ?? 0))} ${large} ${sweep} ${points[0] ?? "0 0"}`,
          );
          break;
        }
      }
    }
    if (figure.getAttribute("IsClosed") === "true") out.push("Z");
  }
  return { d: out.join(""), rule };
}

/** An XPS matrix ("m11,m12,m21,m22,dx,dy") as an SVG transform, or "" for none. */
export function matrix(/** @type {string | null | undefined} */ text) {
  const m = numbers(text);
  if (m.length !== 6) return "";
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return "";
  return `matrix(${m.map(num).join(" ")})`;
}
