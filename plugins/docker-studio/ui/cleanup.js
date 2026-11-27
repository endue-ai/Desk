import { PRUNE_ARGS } from "./schemas.js";

/** @typedef {keyof typeof PRUNE_ARGS} Kind */
/** @typedef {{ kind: Kind, done: boolean, freed?: string, error?: string }} Result */

/** Validate every requested kind before running any cleanup.
 * @param {unknown} values
 * @returns {Kind[]}
 */
export function pruneKinds(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !values.every((value) => typeof value === "string" && Object.hasOwn(PRUNE_ARGS, value))
  ) {
    throw new Error(`Choose cleanup kinds from ${Object.keys(PRUNE_ARGS).join(", ")}.`);
  }
  return [...new Set(values)];
}

/**
 * Runs the exact types already chosen in a dialog or an approved invocation.
 * @param {import("./studio.js").App} app
 * @param {Kind[]} kinds
 * @param {(kind: Kind) => void} [started]
 * @param {(result: Result) => void} [finished]
 */
export async function runPrune(app, kinds, started = () => {}, finished = () => {}) {
  /** @type {Result[]} */
  const results = [];
  for (const kind of kinds) {
    started(kind);
    let result;
    try {
      const { stdout } = await app.docker(PRUNE_ARGS[kind], { timeoutMs: 0 });
      const freed = /Total(?: reclaimed space)?:\s*(.+)/.exec(stdout)?.[1]?.trim();
      result = { kind, done: true, ...(freed ? { freed } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.toast(message, "danger");
      result = { kind, done: false, error: message };
    }
    results.push(result);
    finished(result);
  }
  for (const name of /** @type {const} */ ([
    "containers",
    "images",
    "volumes",
    "networks",
    "disk",
  ])) {
    void app.engine.load(name).catch(() => {});
  }
  return results;
}
