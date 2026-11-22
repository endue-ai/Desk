// A chart's axes (PG-44): an extent with round ticks, a value's place on an axis, a tick's text, and
// text cut to the room it has. Floats here only place marks; the values a chart says are the exact
// text of aggregate.js. No DOM.

/** Round ticks over [low, high], about `count` of them, and the extent they span. */
export function ticks(/** @type {number} */ low, /** @type {number} */ high, count = 5) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: 0, high: 1, values: [0, 1] };
  if (low === high) {
    const pad = Math.abs(low) || 1;
    low -= pad;
    high += pad;
  }
  const raw = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const from = Math.floor(low / step) * step;
  const to = Math.ceil(high / step) * step;
  const values = [];
  for (let v = from; v <= to + step / 2; v += step) values.push(Number(v.toPrecision(12)));
  return { low: from, high: to, values };
}

/** A place on a span of pixels for a value in [low, high]. */
export const place = (
  /** @type {number} */ value,
  /** @type {number} */ low,
  /** @type {number} */ high,
  /** @type {number} */ from,
  /** @type {number} */ to,
) => (high === low ? from : from + ((value - low) / (high - low)) * (to - from));

/** A tick's text: short, without float noise (0.30000000000000004 is 0.3). */
export function tickText(/** @type {number} */ value) {
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-4)) return value.toExponential(2);
  if (abs >= 1e6) return `${Number((value / 1e6).toPrecision(4))}M`;
  return String(Number(value.toPrecision(6)));
}

/** Text cut to `chars` characters, with an ellipsis when it was longer. */
export const cut = (/** @type {string} */ text, /** @type {number} */ chars) =>
  text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}…`;
