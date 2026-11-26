// A copy's run (PG-63). The target's side is one transaction on a session of its own: BEGIN, the
// structure, each table's COPY ... FROM STDIN, the foreign keys, the sequences, COMMIT. Each table's
// rows stream from the source's COPY ... TO STDOUT through a pipe of one chunk (pipe.js) on the
// plugin's COPY call (copy/index.js), both through `deps.execute`, so the guards and Cancel hold.
// Several tables read from the source in one REPEATABLE READ READ ONLY transaction: one snapshot.
// Any failure or Cancel rolls the target back, and both sessions close at the end. No DOM.

import { copyIn, copyOut } from "../copy/index.js";
import { t } from "../strings/index.js";
import { createPipe } from "./pipe.js";
import { failureOf } from "./read.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../catalog.js").Execute} Execute
 * @typedef {import("./plan.js").Plan} Plan
 * @typedef {import("../session/keeper.js").Owner} Owner
 * @typedef {{
 *   source: Connection, target: Connection, plan: Plan, id: string, signal: AbortSignal,
 *   step(index: number): void, progress(index: number, bytes: number): void,
 * }} Job
 *   `step` hears each table start, `progress` the bytes it moved so far.
 */

/** What the pipe fails the source's COPY with when the target stopped reading. */
const STOPPED = t("transfer.run.theTargetStoppedReadingTheRows");
const textOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * Run a copy; answers the rows each table received.
 * @param {{ execute: Execute, forget(owner: string): void }} deps
 * @param {Job} job
 * @returns {Promise<number[]>}
 */
export async function runTransfer(deps, job) {
  const { source, target, plan, signal } = job;
  /** @type {Owner} */
  const into = { owner: `transfer:${job.id}:target`, kind: "table" };
  /** @type {Owner} */
  const from = { owner: `transfer:${job.id}:source`, kind: "table" };
  const own = plan.snapshot ? { session: from } : {};
  const onTarget = (/** @type {string} */ sql) =>
    deps.execute(target, sql, { session: into, signal, asked: true });
  const must = async (
    /** @type {Promise<import("../execute.js").Execution>} */ running,
    conn = target,
  ) => {
    const failed = failureOf(await running);
    if (signal.aborted) throw new Error(t("transfer.run.cancelled"));
    if (failed) throw new Error(`${conn.name}: ${failed}`);
  };
  /** @type {number[]} */
  const rows = [];
  let begun = false;
  try {
    await must(onTarget("BEGIN"));
    begun = true;
    if (plan.setup) await must(onTarget(plan.setup));
    if (plan.snapshot)
      await must(
        deps.execute(source, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", {
          ...own,
          signal,
          catalog: true,
        }),
        source,
      );
    for (const [index, step] of plan.steps.entries()) {
      job.step(index);
      const pipe = createPipe(signal);
      // The source's COPY keeps every guard: a query that writes (RETURNING) asks as a run would.
      const out = copyOut(deps.execute, source, step.out, pipe.sink, {
        ...own,
        signal,
        progress: (p) => {
          if (p) job.progress(index, p.bytes);
        },
      }).then(
        (run) => {
          const failed = failureOf(run);
          if (failed) pipe.fail(new Error(failed));
          return failed;
        },
        (error) => {
          pipe.fail(error instanceof Error ? error : new Error(textOf(error)));
          return textOf(error);
        },
      );
      const read = copyIn(deps.execute, target, step.in, pipe.source, {
        session: into,
        signal,
        asked: true,
      }).finally(() => pipe.fail(new Error(STOPPED)));
      const [outFailed, inRun] = await Promise.all([out, read.catch((error) => error)]);
      if (signal.aborted) throw new Error(t("transfer.run.cancelled"));
      if (outFailed && !outFailed.includes(STOPPED))
        throw new Error(`${source.name}: ${outFailed}`);
      if (inRun instanceof Error) throw new Error(`${target.name}: ${inRun.message}`);
      const inFailed = failureOf(inRun);
      if (inFailed) throw new Error(`${target.name}: ${inFailed}`);
      rows.push(inRun.result.statements[0]?.affected ?? 0);
    }
    if (plan.keys) await must(onTarget(plan.keys));
    if (plan.after) await must(onTarget(plan.after));
    // A cancel after this point would not undo the commit, so it runs without the signal.
    if (signal.aborted) throw new Error(t("transfer.run.cancelled"));
    const committed = failureOf(
      await deps.execute(target, "COMMIT", { session: into, asked: true }),
    );
    if (committed) throw new Error(`${target.name}: ${committed}`);
    begun = false;
    return rows;
  } finally {
    // A rollback runs without the run's signal: a cancelled copy still ends its transaction.
    if (begun)
      await deps.execute(target, "ROLLBACK", { session: into, asked: true }).catch(() => {});
    deps.forget(into.owner);
    deps.forget(from.owner);
  }
}
