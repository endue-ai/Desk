// The explorer's operations on objects (PG-52), from a row (its keys and its menu) or a command's
// arguments (the palette asks for what is missing): the object found, what it takes on its engine,
// a read-only connection refused at once, what the operation needs read, the dialog that shows
// the exact script, and the run through deps.execute (the production and agent guards; a DDL
// statement reads the schema cache again). Generate SQL writes a template into a console. No DOM.

import { answersOf } from "./checks.js";
import { readFacts } from "./facts.js";
import { ENGINE_NAMES, notOffered, OPS, opsOf, said } from "./kinds.js";
import { DIALOG, modelOf } from "./models.js";
import { scriptOf } from "./statements.js";
import { TEMPLATES, templateOf, templatesOf } from "./templates.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../explorer.js").Node} Node
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./kinds.js").Op} Op
 */

/** The object an explorer row stands for, or undefined (a connection, a folder, a column). */
export function targetOfNode(/** @type {Node} */ node) {
  if (node.kind === "schema" && node.schema)
    return { kind: "schema", schema: node.schema, name: node.schema };
  const { part, object } = node;
  if (part)
    return {
      kind: part.kind,
      schema: part.schema,
      name: part.name,
      table: part.table,
      ...(part.kind === "index" && part.extra === "constraint" ? { owned: true } : {}),
    };
  if (object)
    return {
      kind: object.kind,
      schema: object.schema,
      name: object.name,
      ...(object.ident ? { ident: object.ident } : {}),
    };
  return undefined;
}

/** @param {Deps} deps */
export function createObjects(deps) {
  /** The connection and the object a row or a command names; the palette asks for the rest. */
  const resolve = async (
    /** @type {Node | Record<string, unknown>} */ ref,
    /** @type {Op | undefined} */ op,
  ) => {
    if ("key" in ref && typeof ref.key === "string") {
      const node = /** @type {Node} */ (ref);
      const conn = deps.manager.get(node.connection);
      const target = targetOfNode(node);
      if (!conn) throw new Error("That connection is gone.");
      if (!target)
        throw new Error("Pick a schema, an object or a table's part in the explorer first.");
      return { conn, target };
    }
    const args = /** @type {Record<string, unknown>} */ (ref);
    const str = (/** @type {string} */ key) =>
      typeof args[key] === "string" ? String(args[key]) : undefined;
    const conn = await deps.manager.choose(str("connection"), "Database: which connection?");
    if (!conn) throw deps.cancelled("Nothing picked.");
    const schemas = await deps.catalog.schemas(conn);
    const schema =
      str("schema") ??
      (await deps.pick(
        "Database: in which schema?",
        schemas.map((s) => ({ id: s, label: s })),
      ));
    if (!schema) throw deps.cancelled("Nothing picked.");
    if (str("kind") === "schema") return { conn, target: { kind: "schema", schema, name: schema } };
    const table = str("table");
    if (table) {
      const parts = await deps.catalog.parts(conn, schema, table);
      const part = parts.find(
        (p) => p.name === str("name") && (!str("kind") || p.kind === str("kind")),
      );
      if (!part)
        throw new Error(`No ${str("kind") ?? "part"} ${str("name")} is on ${schema}.${table}.`);
      const target = { kind: part.kind, schema, name: part.name, table };
      return {
        conn,
        target:
          part.extra === "constraint" && part.kind === "index"
            ? { ...target, owned: true }
            : target,
      };
    }
    // The palette offers what takes the operation; a named object is found among them all, so
    // what it does not take is said as such.
    const objects = (await deps.catalog.objects(conn, schema)).filter(
      (o) => !str("kind") || o.kind === str("kind"),
    );
    const offered = objects.filter((o) => !op || opsOf(conn.engine, o.kind).includes(op));
    const name =
      str("name") ??
      (await deps.pick(
        `Database: which object of ${schema}?`,
        offered.map((o) => ({ id: o.name, label: o.name, detail: o.kind })),
      ));
    if (!name) throw deps.cancelled("Nothing picked.");
    const found =
      objects.find((o) => o.name === name) ??
      oneOf(objects.filter((o) => o.name.startsWith(`${name}(`)));
    if (!found) throw new Error(`No ${str("kind") ?? "object"} ${schema}.${name} was found.`);
    return {
      conn,
      target: {
        kind: found.kind,
        schema,
        name: found.name,
        ...(found.ident ? { ident: found.ident } : {}),
      },
    };
  };

  /**
   * Run an operation: refused, read, asked, run, said. Answers the script that ran.
   * @param {Connection} conn
   * @param {Op} op
   * @param {Target} target
   * @param {Record<string, unknown>} given
   */
  const operate = async (conn, op, target, given) => {
    const refused = notOffered(conn.engine, op, target);
    if (refused) throw new Error(refused);
    if (conn.readOnly)
      throw new Error(`${conn.name} is read-only: objects are not changed from here.`);
    const facts = await readFacts(deps, conn, op, target);
    const schemas = op === "move" ? await deps.catalog.schemas(conn) : [];
    const model = modelOf(conn, op, target, facts, given, schemas);
    const answer = await deps.dialog(DIALOG, model);
    if (answer === undefined) throw deps.cancelled("Not run.");
    const script = scriptOf(conn.engine, op, target, facts, answersOf(answer));
    const done = await deps.execute(conn, script);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(`Not run: ${failed.message}`);
    deps.say(`${OPS[op].done} ${said(conn.engine, target)}.`);
    return { script };
  };

  /** Write a template of a table or a routine into its connection's console. */
  const generate = async (
    /** @type {Connection} */ conn,
    /** @type {Target} */ target,
    /** @type {unknown} */ which,
  ) => {
    const offered = templatesOf(target.kind);
    const chosen =
      typeof which === "string" && offered.includes(/** @type {never} */ (which))
        ? which
        : offered.length === 1
          ? offered[0]
          : await deps.pick(
              `Database: generate which statement for ${said(conn.engine, target)}?`,
              offered.map((t) => ({ id: t, label: TEMPLATES[t] })),
            );
    if (!chosen) throw deps.cancelled("Nothing generated.");
    const routine = target.kind === "function" || target.kind === "procedure";
    const read = routine
      ? await readFacts(deps, conn, "generate", target)
      : { columns: await deps.catalog.columns(conn, target.schema, target.name) };
    const text = templateOf(conn.engine, /** @type {never} */ (chosen), target, read);
    await deps.consoles.open(conn);
    deps.view.focus("editor");
    deps.view.insert(text);
    deps.say(`${OPS.generate.done} ${said(conn.engine, target)}: run it when it is filled in.`);
    return text;
  };

  /** The row's (or the command's object's) menu of what it takes, another feature's `first`. */
  const menu = async (
    /** @type {Connection} */ conn,
    /** @type {Target} */ target,
    /** @type {{ id: string, label: string }[]} */ first = [],
  ) => {
    const ops = opsOf(conn.engine, target.kind);
    if (ops.length === 0 && first.length === 0)
      throw new Error(`Nothing here changes a ${target.kind} on ${ENGINE_NAMES[conn.engine]}.`);
    const own = ops.flatMap((op) =>
      op === "generate"
        ? templatesOf(target.kind).map((t) => ({
            id: `generate:${t}`,
            label: `Generate ${TEMPLATES[t]}`,
          }))
        : [{ id: op, label: OPS[op].label }],
    );
    const items = [...first, ...own];
    const picked = await deps.pick(`Database: ${said(conn.engine, target)}`, items);
    if (!picked) throw deps.cancelled("Nothing picked.");
    return picked;
  };

  return { resolve, operate, generate, menu };
}

/** The one item of a list, or undefined when it has none or several. */
const oneOf = (/** @type {import("../../schema/common.js").SchemaObject[]} */ list) =>
  list.length === 1 ? list[0] : undefined;
