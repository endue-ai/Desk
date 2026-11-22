/** The stub's rules every db.* call shares: limits, what agents and sessions may, tags (stub-db.ts). */
import { StubError } from "./adapters";
import type { DbServerError, DbValue } from "./generated";
import type { StubStatement } from "./stub-db";

export const MAX_SESSIONS = 16;
export const RESERVED = ["client_encoding", "user", "database", "replication"];
export const bytes = (value: DbValue) =>
  value === null ? 0 : new TextEncoder().encode(value).length;
export const failure = (code: string, message: string): DbServerError => ({
  severity: "ERROR",
  localSeverity: "ERROR",
  code,
  message,
});

export function limits(pageRows = 1000, pageBytes = 4 * 1024 * 1024) {
  if (pageRows < 1 || pageRows > 10_000)
    throw new StubError("invalid_params", "pageRows is 1 to 10000");
  if (pageBytes < 65_536 || pageBytes > 16_777_216)
    throw new StubError("invalid_params", "pageBytes is 65536 to 16777216");
  return { pageRows, pageBytes };
}

export function refuseAgents(caller: string | undefined) {
  if (caller?.startsWith("agent:"))
    throw new StubError("permission_denied", "agents reach databases through the plugin");
}

/** The tag a scripted statement ends with. */
export function tagOf(statement: StubStatement, rows: number): string {
  if (statement.tag) return statement.tag;
  if (statement.columns) return `SELECT ${rows}`;
  const sql = typeof statement.sql === "string" ? statement.sql : "";
  return (sql.trim().split(/\s+/)[0] ?? "").toUpperCase();
}
