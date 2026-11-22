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
      `The target runs PostgreSQL ${target.text}, older than the source's ${source.text}: a type or a default it lacks fails before any row moves.`,
    );
  else if (target.number && source.number && major(target) !== major(source))
    notes.push(`The source runs PostgreSQL ${source.text}, the target ${target.text}.`);
  const structure = facts.content !== "data";
  if (structure)
    for (const type of facts.missingTypes)
      problems.push(`The target has no type ${type}: create it there first.`);
  for (const schema of facts.newSchemas) notes.push(`Schema ${schema} is created on the target.`);
  for (const table of facts.tables) {
    if (structure && table.exists)
      problems.push(
        `${table.label} is already on the target: choose another name, or copy the data only.`,
      );
    if (!structure && !table.exists)
      problems.push(`${table.label} is not on the target: copy its structure too.`);
  }
  if (facts.content !== "structure")
    for (const pair of facts.columns) {
      if (pair.target === null)
        problems.push(`${pair.table} on the target has no column ${pair.column}.`);
      else if (pair.target !== pair.source)
        notes.push(
          `${pair.table}.${pair.column} is ${pair.source} here and ${pair.target} on the target: each value is read as the target's type.`,
        );
    }
  notes.push(...(facts.notes ?? []));
  return { problems, notes };
}
