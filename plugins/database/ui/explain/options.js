// PostgreSQL's EXPLAIN options as toggles: which ones a server's version has, the EXPLAIN they
// make, and the ones a person turned on, remembered per connection in the plugin's store. An
// option that needs ANALYZE is left out without it and GENERIC_PLAN is never sent with it, so the
// server never refuses the combination; an option on by default and turned off is sent as FALSE.

/**
 * @typedef {{
 *   name: string, since: number, hint: string,
 *   needs?: "ANALYZE", not?: "ANALYZE", byDefault?(analyze: boolean, version: number): boolean,
 * }} Option
 *   `since` is the first server_version_num that has it; `byDefault` says when the server turns
 *   it on by itself.
 * @typedef {{ on: string[], version: number, analyze?: boolean }} Chosen
 *   The options turned on and the server's version (server_version_num).
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

/** The oldest server the options are offered for, and what an unknown version is taken as. */
export const FLOOR = 130000;

/** @type {Option[]} */
export const OPTIONS = [
  {
    name: "ANALYZE",
    since: 0,
    hint: "Runs the statement and shows what each step took. A write runs in a transaction that is rolled back, and the read-only, production and agent guards still apply.",
  },
  {
    name: "BUFFERS",
    since: 0,
    hint: "Pages found in the cache and read from disk",
    byDefault: (analyze, version) => analyze && version >= 180000,
  },
  { name: "VERBOSE", since: 0, hint: "Output columns and schema-qualified names" },
  {
    name: "SETTINGS",
    since: 120000,
    hint: "Settings changed from their defaults that the plan used",
  },
  { name: "WAL", since: 130000, needs: "ANALYZE", hint: "Write-ahead log records and bytes" },
  {
    name: "TIMING",
    since: 0,
    needs: "ANALYZE",
    hint: "Time per node; off, the run costs less",
    byDefault: (analyze) => analyze,
  },
  {
    name: "SUMMARY",
    since: 0,
    hint: "Planning and execution time",
    byDefault: (analyze) => analyze,
  },
  {
    name: "GENERIC_PLAN",
    since: 160000,
    not: "ANALYZE",
    hint: "A plan for any values of $1, $2 …, which stay as they are",
  },
  {
    name: "SERIALIZE",
    since: 170000,
    needs: "ANALYZE",
    hint: "Time and bytes it takes to send the rows",
  },
  { name: "MEMORY", since: 170000, hint: "Memory the planner used" },
];

/** What is on when a connection has nothing saved. */
export const DEFAULT_ON = ["BUFFERS", "TIMING", "SUMMARY"];

const NAMES = new Set(OPTIONS.map((o) => o.name));

/** The options a server of this version has. */
export function optionsFor(/** @type {number} */ version) {
  return OPTIONS.filter((o) => o.since <= version);
}

/** A server_version_num as SHOW prints it; the floor when it cannot be read. */
export function versionOf(/** @type {string | null | undefined} */ text) {
  const n = Number.parseInt(String(text ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 90000 ? n : FLOOR;
}

/**
 * The EXPLAIN (…, FORMAT JSON) of a statement with the options turned on.
 * @param {string} statement
 * @param {Chosen} chosen `analyze` wins over ANALYZE in `on`.
 */
export function explainPostgres(statement, { on, version, analyze = on.includes("ANALYZE") }) {
  const wanted = new Set(on);
  const parts = analyze ? ["ANALYZE"] : [];
  for (const option of optionsFor(version)) {
    if (option.name === "ANALYZE") continue;
    if ((option.needs === "ANALYZE" && !analyze) || (option.not === "ANALYZE" && analyze)) continue;
    if (wanted.has(option.name)) parts.push(option.name);
    else if (option.byDefault?.(analyze, version)) parts.push(`${option.name} FALSE`);
  }
  return `EXPLAIN (${[...parts, "FORMAT JSON"].join(", ")}) ${statement}`;
}

const keyOf = (/** @type {string} */ connection) => `explain:${connection}`;

/** The options a connection's person turned on; the defaults when nothing is saved. */
export async function readOptions(/** @type {Bridge} */ bridge, /** @type {string} */ connection) {
  const kept = await bridge.call("store.get", { key: keyOf(connection) }).catch(() => ({}));
  const value = /** @type {{ value?: unknown }} */ (kept).value;
  return Array.isArray(value)
    ? value.filter((name) => typeof name === "string" && NAMES.has(name))
    : [...DEFAULT_ON];
}

/** Keep the options turned on for a connection. */
export async function saveOptions(
  /** @type {Bridge} */ bridge,
  /** @type {string} */ connection,
  /** @type {string[]} */ on,
) {
  const value = on.filter((name) => NAMES.has(name));
  await bridge.call("store.set", { key: keyOf(connection), value }).catch(() => {});
}
