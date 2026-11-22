// Find usages (PG-32): the server's dependency catalog and the routine bodies that name the object,
// in one read-only catalog read (usages-sql.js); the bodies scanned off the frame's thread when they
// are large (mentions-client.js); the connection's open consoles bound by the parse worker's
// resolver. Catalog usages first, then the bodies, then the consoles in their order.

import { scanBodies } from "./mentions-client.js";
import { bodiesOf, bodyUsage, catalogUsages, consoleUsages } from "./usages.js";
import { BODIES_MAX, CATALOG_MAX, usagesSql } from "./usages-sql.js";

/**
 * @typedef {import("./target.js").Aim} Aim
 * @typedef {import("./usages.js").Usage} Usage
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {{
 *   execute: import("../catalog.js").Execute,
 *   startWorker?: import("../explain/reader.js").StartWorker,
 *   resolve(text: string): Promise<{ names: import("../sql/parse/scope.js").Name[] }>,
 * }} FindDeps
 * @typedef {{ id: string, name: string, kind: string, text: string, title?: string,
 *   file?: { path: string, large?: boolean } }} ConsoleLike
 */

/** A console's name as the panel shows it: the person's, else its connection's and number. */
const consoleName = (/** @type {ConsoleLike & { number?: number }} */ c) =>
  c.title ?? (c.number && c.number > 1 ? `${c.name} (${c.number})` : c.name);

/**
 * @param {FindDeps} deps
 * @param {Connection} conn
 * @param {Aim} aim
 * @param {ConsoleLike[]} consoles the connection's open buffers
 * @returns {Promise<{ items: Usage[], capped: boolean }>}
 */
export async function findUsages(deps, conn, aim, consoles) {
  const sql = usagesSql(aim);
  /** @type {Usage[]} */
  let listed = [];
  /** @type {Usage[]} */
  const parsed = [];
  let capped = false;
  if (sql) {
    const { result } = await deps.execute(conn, sql, { catalog: true, maxRows: CATALOG_MAX + 1 });
    const failed = result.error ?? result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
    const [catalog = [], bodies = []] = result.statements.map((s) => s.sets[0]?.rows ?? []);
    capped = catalog.length > CATALOG_MAX || bodies.length > BODIES_MAX;
    listed = catalogUsages(catalog.slice(0, CATALOG_MAX));
    const scan = bodiesOf(bodies.slice(0, BODIES_MAX), listed);
    const found = await scanBodies(
      scan.map((b) => b.source),
      aim,
      deps.startWorker,
    );
    for (const [i, body] of scan.entries()) {
      const usage = bodyUsage(body, found[i] ?? { places: [], count: 0 });
      if (usage) parsed.push(usage);
    }
  }
  for (const c of consoles) {
    if (c.kind !== "console" || c.file?.large || !c.text.trim()) continue;
    const { names } = await deps.resolve(c.text);
    parsed.push(...consoleUsages({ ...c, name: consoleName(c) }, c.text, names, aim));
  }
  return { items: [...listed, ...parsed], capped };
}
