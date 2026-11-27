import { t } from "../strings/index.js";

// What a copy says before anything runs (PG-63): the differences between the two servers and what
// the target already has. A problem holds the copy (a type the target lacks, a table that is there
// already or is missing, a column the target has not); a note is said and the copy may start (an
// older target server, a schema to create, a column of another type, what the structure leaves
// out). No DOM.

/**
 * @typedef {import("./read.js").Version} Version
 * @typedef {"both" | "structure" | "data"} Content
 * @typedef {{ label: string, exists: boolean }} TargetTable
 *   `label` is the target table's name as people read it.
 * @typedef {{ table: string, column: string, source: string, target: string | null }} ColumnPair
 *   `target` is the target column's type, null when the target has no such column.
 * @typedef {{
 *   source: Version, target: Version, content: Content, missingTypes: string[],
 *   newSchemas: string[], tables: TargetTable[], columns: ColumnPair[], notes?: string[],
 * }} Facts
 * @typedef {{ problems: string[], notes: string[] }} Report
 */

const major = (/** @type {Version} */ v) => Math.floor(v.number / 10000);

/**
 * The problems that hold a copy and the notes said with it.
 * @param {Facts} facts
 * @returns {Report}
 */
export function differences(facts) {
  /** @type {string[]} */
  const problems = [];
  const notes = [];
  const { source, target } = facts;
  if (target.number && source.number && major(target) < major(source))
    notes.push(
      t("transfer.compare.theTargetRunsPostgresqlOlderThan", {
        text: String(target.text),
        text2: String(source.text),
      }),
    );
  else if (target.number && source.number && major(target) !== major(source))
    notes.push(
      t("transfer.compare.theSourceRunsPostgresqlTheTarget", {
        text: String(source.text),
        text2: String(target.text),
      }),
    );
  const structure = facts.content !== "data";
  if (structure)
    for (const type of facts.missingTypes)
      problems.push(t("transfer.compare.theTargetHasNoTypeCreate", { type: String(type) }));
  for (const schema of facts.newSchemas)
    notes.push(t("transfer.compare.schemaIsCreatedOnTheTarget", { schema: String(schema) }));
  for (const table of facts.tables) {
    if (structure && table.exists)
      problems.push(
        t("transfer.compare.isAlreadyOnTheTargetChoose", { label: String(table.label) }),
      );
    if (!structure && !table.exists)
      problems.push(t("transfer.compare.isNotOnTheTargetCopy", { label: String(table.label) }));
  }
  if (facts.content !== "structure")
    for (const pair of facts.columns) {
      if (pair.target === null)
        problems.push(
          t("transfer.compare.onTheTargetHasNoColumn", {
            table: String(pair.table),
            column: String(pair.column),
          }),
        );
      else if (pair.target !== pair.source)
        notes.push(
          t("transfer.compare.isHereAndOnTheTarget", {
            table: String(pair.table),
            column: String(pair.column),
            source: String(pair.source),
            target: String(pair.target),
          }),
        );
    }
  notes.push(...(facts.notes ?? []));
  return { problems, notes };
}
