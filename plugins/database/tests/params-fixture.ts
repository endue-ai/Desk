// A scripted server's answers for bound parameters and the check without running (PG-21, ADR 0353),
// for the runtime fixture page: a check (db.describe) of a statement on `orders` answers each
// parameter's type by the column it is compared with and the select list's columns; a run of one
// with bound values answers two orders; format_type names the types. Every other statement goes to
// the script behind it. Fixture data only; it needs no Node.
import type { BridgeEvent } from "../../../packages/bridge/src/index";
import type { Answer, Script } from "./clients";
import { dbHandlers } from "./fixtures";

const TYPES: Record<string, number> = { id: 23, total: 1700, least: 1700, at: 1184, since: 1184 };
const NAMES: Record<string, string> = {
  "23": "integer",
  "25": "text",
  "1700": "numeric",
  "1184": "timestamp with time zone",
};
const typeOf = (name: string) => TYPES[name.toLowerCase()] ?? 25;

/** Each `$n`'s type, by the column it is compared with. */
function paramTypes(sql: string) {
  const types: number[] = [];
  for (const match of sql.matchAll(/(\w+)\s*(?:=|<>|<=|>=|<|>)\s*\$(\d+)/gu))
    types[Number(match[2]) - 1] = typeOf(match[1] ?? "");
  return Array.from(types, (t) => t ?? 25);
}

/** The select list's columns, by their names or aliases. */
function columnsOf(sql: string) {
  const list = /^\s*select\s+(.*?)\s+from\s/isu.exec(sql)?.[1];
  if (!list) return undefined;
  return list.split(",").map((item) => /(\w+)\s*$/u.exec(item.trim())?.[1] ?? "?column?");
}

export function paramsServer(inner: Script): Script {
  return (sql, who, bound) => {
    if (sql.startsWith("SELECT t.oid::text, pg_catalog.format_type")) {
      const oids = (bound?.params?.[0] ?? "{}").replace(/[{}]/gu, "").split(",");
      return { rows: [["oid", "format_type"], ...oids.map((oid) => [oid, NAMES[oid] ?? oid])] };
    }
    if (!/\bfrom orders\b/iu.test(sql)) return inner(sql, who, bound);
    const columns = columnsOf(sql);
    if (bound?.describe) {
      const answer: Answer = { paramTypes: paramTypes(sql) };
      return columns ? { ...answer, rows: [columns], types: columns.map(typeOf) } : answer;
    }
    const orders: Record<string, string>[] = [
      { id: "1", person: "ada", total: "12.50", at: "2026-11-02 09:00:00+00" },
      { id: "4", person: "ada", total: "40.00", at: "2026-11-09 17:30:00+00" },
    ];
    const head = columns ?? ["id"];
    return {
      rows: [head, ...orders.map((o) => head.map((c) => o[c] ?? null))],
      types: head.map(typeOf),
    };
  };
}

/** db.* over `inner` with the answers above first. */
export const paramsHandlers = (inner: Script, emit: (event: BridgeEvent) => void) =>
  dbHandlers(paramsServer(inner), emit);
