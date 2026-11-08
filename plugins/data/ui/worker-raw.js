// Slice and mask source lines inside the worker; source text and offsets never need a main copy.
import { hexRow, rawLines } from "./raw.js";
import { union } from "./raw-view.js";

export function workerRaw(opened, hidden) {
  const lines = rawLines(opened);
  let ranges = union(hidden);
  const firstAfter = (at) => {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (ranges[mid][1] <= at) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const textLine = (n, current) => {
    const start = lines.start(n);
    const end = lines.end(n);
    const focus = current?.line === n ? start + current.col - 1 : start;
    const from = end - start > 2000 ? Math.max(start, focus - 200) : start;
    const to = Math.min(end, from + 2000);
    let out = from > start ? "… " : "";
    let at = from;
    for (let i = firstAfter(from); i < ranges.length; i++) {
      const [a, b] = ranges[i];
      if (a >= to) break;
      if (a > at) out += opened.text.slice(at, a);
      out += "••••••••";
      at = Math.min(Math.max(at, b), to);
    }
    if (at < to) out += opened.text.slice(at, to);
    if (to < end) out += ` … ${(end - to).toLocaleString("en-US")} more characters`;
    return out;
  };
  const errors = new Map(
    opened.doc?.errors.map((error) => [error.line, error.message.slice(0, 500)]) ?? [],
  );
  return {
    count: lines.count,
    mask(hidden) {
      ranges = union(hidden);
    },
    read(from, count, current) {
      const items = [];
      for (let n = Math.max(1, from); n <= lines.count && items.length < count; n++) {
        const text =
          lines.kind === "hex"
            ? hexRow(opened.bytes, lines.start(n), lines.end(n), (at) => {
                const range = ranges[firstAfter(at)];
                return range && range[0] <= at;
              })
            : textLine(n, current);
        items.push({ line: n, text, error: errors.get(n) });
      }
      return { count: lines.count, kind: lines.kind, lines: items };
    },
  };
}
