// The exact server and configured password helper are reviewed from a person's Save or Test.
import { targetOf } from "../engines/pg-session.js";
import { t } from "../strings/index.js";
import { scopeOf } from "../tunnel/open.js";
import { argvOf } from "./command.js";
import { commandFor } from "./fields.js";

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @param {import("../engines/common.js").Connection} conn
 * @param {boolean} remembered
 * @param {(title: string, reasons: string[]) => Promise<boolean>} confirm
 */
export async function reviewConnection(bridge, conn, remembered, confirm) {
  if (conn.engine !== "postgresql") return true;
  const target = targetOf(conn);
  if (typeof target === "string") return true;
  const where = `${target.host}:${target.port}`;
  const command = commandFor(conn);
  /** @type {import("@endue-ai/bridge").Permission[]} */
  const scopes = [scopeOf(where, conn)];
  if (command) {
    const { program } = argvOf(command);
    if (!program) throw new Error(t("auth.review.thePasswordCommandNamesNoProgram"));
    scopes.push({ permission: "proc:spawn", commands: [program] });
  }
  const held = await Promise.all(
    scopes.map(async (permission) => {
      const answer = await bridge.call("perm.query", { permission }).catch(() => ({ grants: [] }));
      return answer.grants.length > 0;
    }),
  );
  const missing = scopes.filter((_scope, index) => !held[index]);
  const purpose = `Connect ${conn.name} to ${where}.${command ? ` Password command: ${command}` : ""}`;
  if (missing.length === 0) {
    return (
      !command ||
      remembered ||
      confirm(t("auth.review.databaseAllowThePasswordCommandFor", { name: String(conn.name) }), [
        purpose,
      ])
    );
  }
  const reason =
    missing.length > 1 ? `[database-connect:${crypto.randomUUID()}]\n${purpose}` : purpose;
  const answers = await Promise.all(
    missing.map(async (permission) =>
      bridge
        .call("perm.request", { permission, reason, duration: "session", again: true })
        .catch(() => ({ granted: false })),
    ),
  );
  return answers.every(({ granted }) => granted);
}
