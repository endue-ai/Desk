// The privileges panels' controller (PG-54): one panel per PostgreSQL connection with four tabs,
// Roles, Object (an object's matrix, a table's row security), Role (what a role may do) and
// Defaults; each tab read when it is shown and again on a refresh, the probe first. The person's
// matrix edits stay in the panel until they are reviewed (changes.js) or discarded. index.js's
// commands and actions call it. No DOM.

import { engineOf } from "../../engines/index.js";
import { createObjects, targetOfNode } from "../objects/controller.js";
import { editKey, nextState } from "./acl.js";
import { kindOf, saidOf } from "./kinds.js";
import { membersOf } from "./model.js";
import { createReader } from "./read.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {"roles" | "object" | "role" | "defaults"} Tab
 * @typedef {{
 *   conn: { name: string, readOnly: boolean, tag: string }, tab: Tab, reading: boolean, error: string,
 *   probe: import("./model.js").Probe | null,
 *   roles: Awaited<ReturnType<ReturnType<typeof createReader>["roles"]>> | null,
 *   target: Target | null, object: any, edits: Record<string, import("./acl.js").CellState>,
 *   extra: { grantee: string, column: string }[],
 *   role: string, view: Awaited<ReturnType<ReturnType<typeof createReader>["role"]>> | null,
 *   defaults: Awaited<ReturnType<ReturnType<typeof createReader>["defaults"]>> | null,
 *   defaultEdits: Record<string, Record<string, import("./acl.js").CellState>>,
 * }} PrivState
 */

export const TYPE = "privileges";
export const TABS = /** @type {const} */ (["roles", "object", "role", "defaults"]);

const about = (/** @type {Connection} */ c) => ({ name: c.name, readOnly: c.readOnly, tag: c.tag });
/** @returns {PrivState} */
const fresh = (/** @type {Connection} */ conn) => ({
  conn: about(conn),
  tab: "roles",
  reading: false,
  error: "",
  probe: null,
  roles: null,
  target: null,
  object: null,
  edits: {},
  extra: [],
  role: "",
  view: null,
  defaults: null,
  defaultEdits: {},
});
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** @param {Deps} deps */
export function createPrivileges(deps) {
  const reader = createReader({ execute: deps.execute });
  const objects = createObjects(deps);
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  /** @returns {PrivState | undefined} */
  const stateOf = (/** @type {string} */ id) => panelOf(id)?.[TYPE];
  const update = (/** @type {string} */ id, /** @type {Partial<PrivState>} */ patch) => {
    const now = stateOf(id);
    if (now) deps.consoles.updatePanel(id, { ...now, ...patch });
  };
  const connOf = (/** @type {string} */ id) => {
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!conn) throw new Error("This panel's connection was removed.");
    return conn;
  };

  const postgres = (/** @type {Connection} */ conn) => {
    if (conn.engine !== "postgresql")
      throw new Error(
        `${conn.name} is ${engineOf(conn.engine).title}: roles and privileges are read from PostgreSQL connections.`,
      );
    return conn;
  };
  /** The connection named, else the one on screen, the only one or one picked. */
  const choose = async (/** @type {unknown} */ ref) => {
    if (typeof ref === "string" && ref !== "") {
      const conn = deps.manager.get(ref);
      if (!conn) throw new Error(`No connection is named ${ref}.`);
      return postgres(conn);
    }
    const shown = deps.consoles.current();
    const here = shown ? deps.manager.get(shown.connection) : undefined;
    if (here?.engine === "postgresql") return here;
    const list = deps.manager.list().filter((c) => c.engine === "postgresql");
    if (list.length === 0)
      throw new Error("No PostgreSQL connection yet: add one with Database: new connection.");
    if (list.length === 1) return /** @type {Connection} */ (list[0]);
    const items = list.map((c) => ({
      id: c.id,
      label: c.name,
      ...(c.tag !== "none" ? { detail: c.tag } : {}),
    }));
    const picked = await deps.pick("Database: roles and privileges of which connection?", items);
    if (!picked) throw deps.cancelled("Nothing picked.");
    return /** @type {Connection} */ (deps.manager.get(picked));
  };

  /** Read what a panel's tab shows (and the roles, which every tab lists), the probe first. */
  const read = async (/** @type {string} */ id) => {
    const conn = connOf(id);
    const state = stateOf(id);
    if (!state) return undefined;
    update(id, { reading: true, conn: about(conn) });
    try {
      const probe = await reader.probe(conn);
      /** @type {Partial<PrivState>} */
      const patch = { probe, roles: await reader.roles(conn, probe), reading: false, error: "" };
      if (state.tab === "object" && state.target)
        patch.object = await reader.object(conn, probe, state.target);
      if (state.tab === "role" && state.role)
        patch.view = await reader.role(conn, probe, state.role);
      if (state.tab === "defaults") patch.defaults = await reader.defaults(conn, probe);
      update(id, patch);
      return stateOf(id);
    } catch (error) {
      update(id, { reading: false, error: words(error) });
      throw error;
    }
  };

  /** Open (or show again) a connection's panel on a tab with what it shows, and read it. */
  const show = async (/** @type {Connection} */ conn, /** @type {Partial<PrivState>} */ patch) => {
    postgres(conn);
    const name = `privileges: ${conn.name}`;
    const kept = panels().find((b) => b.connection === conn.id && b.name === name)?.[TYPE];
    const state = { ...(kept ?? fresh(conn)), conn: about(conn), ...patch };
    const panel = await deps.consoles.openPanel(conn, TYPE, name, state);
    const read_ = await read(panel.id);
    return { id: panel.id, state: /** @type {PrivState} */ (read_) };
  };

  /** The object a command names: the database, one of no schema, a schema, or one found. */
  const targetOf = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ args,
  ) => {
    const kind = typeof args.kind === "string" ? args.kind : undefined;
    const name = typeof args.name === "string" ? args.name : undefined;
    if (kind === "database") return { kind, schema: "", name: conn.database ?? "" };
    if (kind && kindOf(kind)?.level) {
      if (!name) throw new Error(`Name the ${kind}.`);
      return { kind, schema: "", name };
    }
    if (kind === "schema") {
      const schema = name ?? (typeof args.schema === "string" ? args.schema : undefined);
      if (schema) return { kind, schema, name: schema };
    }
    const { target } = await objects.resolve({ ...args, connection: conn.id }, undefined);
    if (!kindOf(target.kind)) throw new Error(`A ${target.kind} has no privileges of its own.`);
    return target;
  };

  /** Show an object's matrix. */
  const showObject = async (/** @type {Connection} */ conn, /** @type {Target} */ target) =>
    show(conn, { tab: "object", target, object: null, edits: {}, extra: [] });

  /** Show what a role may do. */
  const showRole = async (/** @type {Connection} */ conn, /** @type {string} */ role) =>
    show(conn, { tab: "role", role, view: null });

  /** The explorer's `p` on a row: a role's view, an object's matrix, else the roles. */
  const fromNode = async (/** @type {import("../../explorer.js").Node} */ node) => {
    const conn = deps.manager.get(node.connection);
    if (!conn) throw new Error("That connection is gone.");
    if (node.object?.kind === "role") return showRole(conn, node.object.name);
    if (node.part?.kind === "policy")
      return showObject(conn, { kind: "table", schema: node.part.schema, name: node.part.table });
    if (node.kind === "folder" && node.label === "Database")
      return showObject(conn, { kind: "database", schema: "", name: conn.database ?? "" });
    const target = node.object
      ? {
          kind: node.object.kind,
          schema: node.object.schema,
          name: node.object.name,
          ...(node.object.ident ? { ident: node.object.ident } : {}),
        }
      : targetOfNode(node);
    if (target && kindOf(target.kind) && !node.part) return showObject(conn, target);
    return show(conn, { tab: "roles" });
  };

  /** Change a panel's tab; a tab not read yet is read. */
  const tab = async (/** @type {string} */ id, /** @type {Tab} */ to) => {
    if (!TABS.includes(to)) throw new Error(`No tab ${to}.`);
    update(id, { tab: to });
    return read(id);
  };

  /** Press a matrix cell: none, granted, with grant option. `entry` names a default entry. */
  const press = (
    /** @type {string} */ id,
    /** @type {{ grantee: string, column?: string, privilege: string, entry?: string, now: import("./acl.js").CellState }} */ cell,
  ) => {
    const state = stateOf(id);
    if (!state) return;
    const key = editKey(cell.grantee, cell.column ?? "", cell.privilege);
    if (cell.entry !== undefined) {
      const edits = { ...(state.defaultEdits[cell.entry] ?? {}), [key]: nextState(cell.now) };
      update(id, { defaultEdits: { ...state.defaultEdits, [cell.entry]: edits } });
    } else update(id, { edits: { ...state.edits, [key]: nextState(cell.now) } });
  };

  /** Add a grantee's (or a grantee's column's) empty row to the matrix. */
  const addGrantee = (
    /** @type {string} */ id,
    /** @type {string} */ grantee,
    /** @type {string} */ column = "",
  ) => {
    const state = stateOf(id);
    const name = grantee.trim();
    if (!state || !name) return;
    const who = name.toUpperCase() === "PUBLIC" ? "PUBLIC" : name;
    if (state.extra.some((x) => x.grantee === who && x.column === column)) return;
    update(id, { extra: [...state.extra, { grantee: who, column }] });
  };

  /** A command's grant and revoke lists as edits of the matrix: ALL is every privilege shown. */
  const plan = (
    /** @type {string} */ id,
    /** @type {string} */ grantee,
    /** @type {string} */ column,
    /** @type {Record<string, unknown>} */ args,
  ) => {
    const state = stateOf(id);
    const offered = /** @type {string[]} */ (state?.object?.privileges ?? []);
    if (!state || state.object?.error) throw new Error(state?.object?.error || "Not read.");
    const who = grantee.trim().toUpperCase() === "PUBLIC" ? "PUBLIC" : grantee.trim();
    const words = (/** @type {unknown} */ list) => {
      const given = Array.isArray(list) ? list.map((x) => String(x).toUpperCase()) : [];
      if (given.includes("ALL")) return offered;
      for (const p of given)
        if (!offered.includes(p))
          throw new Error(
            `${p} is not a privilege of ${saidOf(/** @type {Target} */ (state.target))}: ${offered.join(", ")}.`,
          );
      return given;
    };
    /** @type {Record<string, import("./acl.js").CellState>} */
    const edits = {};
    for (const p of words(args.revoke)) edits[editKey(who, column, p)] = "none";
    for (const p of words(args.grant))
      edits[editKey(who, column, p)] = args.grantOption === true ? "option" : "granted";
    update(id, { edits });
  };

  /** Forget the person's edits of the matrix (or of the defaults). */
  const discard = (/** @type {string} */ id, /** @type {"object" | "defaults"} */ which) =>
    update(id, which === "defaults" ? { defaultEdits: {} } : { edits: {}, extra: [] });

  /** What the panel answers an agent: the roles, with members and memberships. */
  const rolesAnswer = (/** @type {PrivState} */ s) => ({
    user: s.probe?.user,
    cannot: s.probe?.cannot ?? [],
    error: s.roles?.error || s.roles?.membersError || undefined,
    roles: (s.roles?.roles ?? []).map((r) => ({
      ...r,
      ...membersOf(s.roles?.memberships ?? [], r.name),
    })),
  });

  return {
    choose,
    show,
    read,
    plan,
    targetOf,
    showObject,
    showRole,
    fromNode,
    tab,
    press,
    addGrantee,
    discard,
    rolesAnswer,
    stateOf,
    update,
    connOf,
    said: saidOf,
  };
}
