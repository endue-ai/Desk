// The search in the top bar: words match anywhere in a row's text; `key:value` qualifiers match one
// field (`is:running`, `stack:shop`, `image:nginx`, `port:8080`); `-word` leaves rows out. Pure.

/**
 * @typedef {{ words: string[], not: string[], fields: Array<[string, string]> }} Query
 */

/** @returns {Query} */
export function parseQuery(/** @type {string} */ text) {
  /** @type {Query} */
  const q = { words: [], not: [], fields: [] };
  for (const raw of text.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    const field = /^([a-z]+):(.+)$/.exec(raw);
    if (field) q.fields.push([field[1] ?? "", field[2] ?? ""]);
    else if (raw.startsWith("-") && raw.length > 1) q.not.push(raw.slice(1));
    else q.words.push(raw);
  }
  return q;
}

/**
 * Whether a row matches: `text` is everything searchable about it, `field(name)` a qualifier's
 * values (undefined when the row has no such field, which never matches).
 * @param {Query} q
 * @param {string} text
 * @param {(name: string) => string[] | undefined} field
 */
export function matches(q, text, field) {
  const hay = text.toLowerCase();
  if (!q.words.every((w) => hay.includes(w))) return false;
  if (q.not.some((w) => hay.includes(w))) return false;
  return q.fields.every(([name, value]) =>
    (field(name) ?? []).some((v) => v.toLowerCase().includes(value)),
  );
}

/** The searchable text and fields of a container. @param {import("./parse.js").Container} c */
export function containerFields(c) {
  const ports = c.ports.map((p) => `${p.host}:${p.container}`);
  const is = [c.state, c.health, c.state === "exited" && c.exitCode !== 0 ? "failed" : ""].filter(
    Boolean,
  );
  return {
    text: [c.name, c.id.slice(0, 12), c.image, c.project, c.service, ...ports, ...is].join(" "),
    field: (/** @type {string} */ name) =>
      name === "is" || name === "state"
        ? is
        : name === "stack" || name === "project"
          ? [c.project]
          : name === "image"
            ? [c.image]
            : name === "port"
              ? ports
              : name === "name"
                ? [c.name]
                : name === "network"
                  ? c.networks.map((n) => n.name)
                  : undefined,
  };
}
