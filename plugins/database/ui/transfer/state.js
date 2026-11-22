// What a copy's panel draws (PG-63), as plain data the panel keeps: where from and where to, the
// status, the report's problems and notes, the target's script, each table's bytes and rows, and an
// append's column mapping. No DOM.

/**
 * @typedef {"checking" | "ready" | "held" | "running" | "done" | "failed" | "cancelled"} Status
 *   `held`: the report has a problem, so Start waits.
 * @typedef {{ source: string, target: string, bytes: number, rows: number | null, state: "waiting" | "copying" | "done" }} StepState
 * @typedef {{ source: string, target: string, choices: string[] }} MappingRow
 *   `target` "" leaves the result column out.
 * @typedef {{
 *   title: string, from: string, to: string, status: Status, problems: string[], notes: string[],
 *   script: string, steps: StepState[], mapping: MappingRow[] | null, result: string,
 * }} TransferState
 */

/** A panel's first state, while both sides are read. */
export function stateOf(/** @type {Pick<TransferState, "title" | "from" | "to">} */ head) {
  /** @type {TransferState} */
  const state = {
    ...head,
    status: "checking",
    problems: [],
    notes: [],
    script: "",
    steps: [],
    mapping: null,
    result: "",
  };
  return state;
}
