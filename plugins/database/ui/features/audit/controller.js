// The person's side of agents' access (PG-91): the audit panel of a connection (what agents did,
// newest first, drawn again when an entry comes), what agents may reach of it (closed to agents,
// EXPLAIN ANALYZE allowed, the sensitive columns), the list exported as JSON into ~/Downloads, and
// the list cleared after a question. Agents reach none of it: the gate keeps these for the person.
// No DOM.

import { baseOf } from "../../databases.js";
import { EXPORT_FOLDER, exportName } from "../../export.js";
import { t } from "../../strings/index.js";
import { columnOf } from "./access.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {ReturnType<typeof import("./agents.js").createAgents>} Agents
 * @typedef {{
 *   connection: string, name: string, tag: string, entries: import("./log.js").Entry[],
 *   access: import("./access.js").Access, note: string,
 * }} AuditState
 */

export const TYPE = "agentAudit";
export const AUDIT_FORMAT = "endue.database.agent-audit";

/**
 * @param {Deps} deps
 * @param {Agents} agents
 */
export function createAudit(deps, agents) {
  const { consoles, manager } = deps;
  const bufferOf = (/** @type {string} */ id) =>
    consoles.list().find((b) => b.kind === TYPE && b.connection === id);

  /** A connection named, else the one whose list is on screen, else one picked. */
  const target = async (/** @type {unknown} */ ref) => {
    if (typeof ref === "string" && ref) return manager.choose(ref, "");
    const shown = consoles.current();
    const conn = shown?.kind === TYPE ? manager.get(shown.connection) : undefined;
    return (
      conn ??
      manager.choose(undefined, t("features.audit.controller.databaseAgentAuditOfWhichConnection"))
    );
  };
  const byId = (/** @type {string} */ id) => {
    const conn = manager.get(id);
    if (!conn) throw new Error(t("features.audit.controller.thatConnectionIsGone"));
    return conn;
  };

  /** @returns {Promise<AuditState>} */
  const stateOf = async (/** @type {Connection} */ conn, note = "") => ({
    connection: conn.id,
    name: conn.name,
    tag: conn.tag,
    entries: await agents.log.read(conn.id),
    access: await agents.access.of(conn.id),
    note,
  });
  const redraw = async (/** @type {Connection} */ conn, note = "") => {
    const buffer = bufferOf(conn.id);
    if (buffer) consoles.updatePanel(buffer.id, await stateOf(conn, note));
  };
  agents.onChange((connection) => {
    const conn = manager.get(baseOf(connection));
    if (conn) void redraw(conn).catch(() => {});
  });

  const open = async (/** @type {Record<string, unknown>} */ args) => {
    const conn = await target(args.connection);
    if (!conn) return undefined;
    const state = await stateOf(conn);
    await consoles.openPanel(conn, TYPE, `agent audit: ${conn.name}`, state);
    return { connection: conn.name, entries: state.entries.length, access: state.access };
  };

  /** Change what agents may reach of a connection; answers the new access. */
  const change = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ args,
  ) => {
    const now = await agents.access.of(conn.id);
    /** @type {Partial<import("./access.js").Access>} */
    const patch = {};
    if (typeof args.closed === "boolean") patch.closed = args.closed;
    if (typeof args.analyze === "boolean") patch.analyze = args.analyze;
    let sensitive = Array.isArray(args.sensitive) ? args.sensitive.map(String) : now.sensitive;
    if (args.add !== undefined) {
      const column = columnOf(args.add);
      if (!column.name) throw new Error(column.error);
      sensitive = [...sensitive, column.name];
    }
    if (typeof args.remove === "string")
      sensitive = sensitive.filter((s) => s.toLowerCase() !== String(args.remove).toLowerCase());
    patch.sensitive = sensitive;
    const next = await agents.access.set(conn.id, patch);
    const said = next.closed
      ? t("features.audit.controller.isClosedToAgents", { name: String(conn.name) })
      : t("features.audit.controller.agentsMayRead", {
          name: String(conn.name),
          value: String(
            next.sensitive.length
              ? t("features.audit.controller.withSensitiveMasked", {
                  length: String(next.sensitive.length),
                  value: String(
                    next.sensitive.length === 1
                      ? t("features.audit.controller.column")
                      : t("features.audit.controller.columns"),
                  ),
                })
              : "",
          ),
        });
    deps.say(said);
    await redraw(conn, said);
    return next;
  };

  /** Write the list as JSON into ~/Downloads; answers the path. */
  const exportList = async (/** @type {Connection} */ conn) => {
    const entries = await agents.log.read(conn.id);
    const at = new Date();
    const content = `${JSON.stringify({ format: AUDIT_FORMAT, version: 1, connection: conn.name, exported: at.toISOString(), entries }, null, 2)}\n`;
    const path = `${EXPORT_FOLDER}/${exportName(`agent-audit-${conn.name}`, "json", at)}`;
    const scope = { permission: /** @type {const} */ ("fs:write"), paths: [`${EXPORT_FOLDER}/**`] };
    const write = () =>
      deps.bridge.call("fs.write", { path, content, encoding: "utf8", createDirs: true, scope });
    try {
      await write();
    } catch {
      const decision = await deps.bridge
        .call("perm.request", {
          permission: scope,
          reason: `To export the agent audit list to ${path}`,
        })
        .catch(() => ({ granted: false }));
      if (!decision.granted)
        throw new Error(t("features.audit.controller.notAllowedToWrite", { path: String(path) }));
      await write();
    }
    const said = t("features.audit.controller.exportedTo", {
      length: String(entries.length),
      value: String(
        entries.length === 1
          ? t("features.audit.controller.entry")
          : t("features.audit.controller.entries"),
      ),
      path: String(path),
    });
    deps.say(said);
    await redraw(conn, said);
    return { path, entries: entries.length };
  };

  const clear = async (/** @type {Connection} */ conn) => {
    const count = (await agents.log.read(conn.id)).length;
    const asked = await deps.confirm(
      t("features.audit.controller.clearTheAgentAuditListOf", { name: String(conn.name) }),
      [
        t("features.audit.controller.itsForGoodExportTheList", {
          count: String(count),
          value: String(
            count === 1
              ? t("features.audit.controller.entryGoes")
              : t("features.audit.controller.entriesGo"),
          ),
        }),
      ],
    );
    if (!asked) throw deps.cancelled(t("features.audit.controller.notCleared"));
    await agents.log.clear(conn.id);
    const said = t("features.audit.controller.clearedTheAgentAuditListOf", {
      name: String(conn.name),
    });
    deps.say(said);
    await redraw(conn, said);
    return said;
  };

  const chosen = async (/** @type {unknown} */ ref) => {
    const conn = await target(ref);
    if (!conn) throw deps.cancelled(t("features.audit.controller.noConnectionChosen"));
    return conn;
  };

  return {
    commands: {
      "endue.database.agent-audit": open,
      "endue.database.agent-access": async (/** @type {Record<string, unknown>} */ args) =>
        change(await chosen(args.connection), args),
      "endue.database.agent-audit-export": async (/** @type {Record<string, unknown>} */ args) =>
        exportList(await chosen(args.connection)),
      "endue.database.agent-audit-clear": async (/** @type {Record<string, unknown>} */ args) =>
        clear(await chosen(args.connection)),
    },
    actions: {
      auditAccess: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ patch) =>
        change(byId(id), patch),
      auditExport: (/** @type {string} */ id) => exportList(byId(id)),
      auditClear: (/** @type {string} */ id) => clear(byId(id)),
      auditRefresh: (/** @type {string} */ id) => redraw(byId(id)),
    },
  };
}
