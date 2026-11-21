// A scripted PostgreSQL server for the explorer's operations on objects (ui/features/objects/), over
// the fixture shop (pg-catalog.ts): what is read before a dialog (what depends on an object from
// pg_depend, a routine's arguments, a comment, the owner and the roles, a truncate's tables and
// sequences, a trigger's state and function), the definitions a source edit opens, and the DDL
// itself, which it records and leaves to the rest of the page to answer. As a real server does, a
// plain DROP of what others depend on is refused, and a source that does not parse fails with its
// line. The unit tests and the runtime e2e
// page (packages/runtime/e2e/fixture/database.ts) share it; it needs no Node. Fixture data only.
import type { Answer, Script } from "./clients";

export interface ObjectsServer {
  script: Script;
  /** Every DDL statement that ran, in order (the failed ones too). */
  ran: string[];
}

const DEPENDENTS_HEAD = ["type", "identity", "blocking", "count"];

/** What depends on each object: [type, identity, blocks a plain DROP]. */
// biome-ignore format: one dependent a line
const DEPENDENTS: Record<string, [string, string, boolean][]> = {
  "public.orders": [
    ["view", "public.big_orders", true],
    ["table constraint", "orders_person_fkey on public.orders", false],
    ["table constraint", "orders_pkey on public.orders", false],
    ["table constraint", "orders_total_check on public.orders", false],
  ],
  "public.people": [
    ["table constraint", "orders_person_fkey on public.orders", true],
    ["index", "public.people_name", false],
    ["sequence", "public.people_id_seq", false],
    ["table constraint", "people_pkey on public.people", false],
    ["trigger", "people_touch on public.people", false],
  ],
  "16404": [["trigger", "people_touch on public.people", true]],
  "sales.daily": [["index", "sales.daily_day", false]],
};

/** A routine's name, identity arguments, argument count, names and modes, by its oid. */
const ROUTINES: Record<string, string[]> = {
  "16404": ["touch", "", "0", "", ""],
  "16405": [
    "refund",
    "order_id integer, INOUT done boolean",
    "2",
    '["order_id","done"]',
    '["i","b"]',
  ],
};

const TOUCH =
  "CREATE OR REPLACE FUNCTION public.touch()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  NEW.joined := now();\n  RETURN NEW;\nEND\n$function$\n";
const REFUND =
  "CREATE OR REPLACE PROCEDURE public.refund(IN order_id integer, INOUT done boolean)\n LANGUAGE plpgsql\nAS $procedure$\nBEGIN\n  done := true;\nEND\n$procedure$\n";
const VIEWS: Record<string, string> = {
  "public.big_orders": " SELECT id,\n    total\n   FROM orders\n  WHERE total > 100::numeric;",
  "sales.daily": " SELECT person,\n    sum(total) AS total\n   FROM orders\n  GROUP BY person;",
};
const COMMENTS: Record<string, string> = { "public.people": "Who buys", "16404": "Sets updated" };

const unquote = (name: string) => name.replace(/^"|"$/gu, "").replaceAll('""', '"');
const literal = (text: string, pattern: RegExp) =>
  pattern.exec(text)?.[1]?.replaceAll("''", "'") ?? "";

/** The object a read's root names: `schema.name` of a relation, a routine's oid, a part's name. */
function rootOf(sql: string): string {
  const relation = literal(sql, /to_regclass\('((?:[^']|'')*)'\)::oid AS o/u);
  if (relation)
    return relation
      .split(/(?<=")\.(?=")/u)
      .map(unquote)
      .join(".");
  const routine = /(\d+)::oid AS o/u.exec(sql)?.[1];
  if (routine) return routine;
  return literal(sql, /(?:tgname|conname|nspname) = '((?:[^']|'')*)'/u);
}

/** The reads the dialogs make, or undefined for another statement. */
function read(sql: string): Answer | undefined {
  if (!/^WITH (RECURSIVE )?root AS \(/u.test(sql)) return undefined;
  const root = rootOf(sql);
  if (sql.includes("pg_catalog.pg_depend d ON d.refclassid") && sql.startsWith("WITH RECURSIVE")) {
    const found = DEPENDENTS[root] ?? [];
    const rows = [...found].sort((a, b) => Number(b[2]) - Number(a[2]));
    return {
      rows: [DEPENDENTS_HEAD, ...rows.map(([t, i, b]) => [t, i, String(b), String(rows.length)])],
    };
  }
  if (sql.includes("SELECT p.proname, pg_catalog.pg_get_function_identity_arguments"))
    return {
      rows: [["proname", "args", "n", "names", "modes"], ROUTINES[root] ?? ["", "", "0", "", ""]],
    };
  if (sql.includes("SELECT d.description FROM root"))
    return { rows: [["description"], [COMMENTS[root] ?? ""]] };
  if (sql.includes("pg_catalog.pg_get_userbyid")) return { rows: [["owner"], ["app"]] };
  if (sql.includes("FROM pg_catalog.pg_roles r"))
    return { rows: [["rolname"], ["app"], ["reports"], ["postgres"]] };
  if (sql.includes("k.contype = 'f' AND k.confrelid = root.o"))
    return {
      rows: [
        ["referencing", "sequences", "rows"],
        root === "public.people"
          ? ['["public.orders"]', '["public.people_id_seq"]', "4"]
          : ["[]", "[]", "2"],
      ],
    };
  if (sql.includes("c.relispopulated::text"))
    return {
      rows: [
        ["populated", "unique"],
        ["true", "true"],
      ],
    };
  if (sql.includes("SELECT t.tgenabled::text")) return { rows: [["tgenabled"], ["O"]] };
  if (sql.includes("pg_catalog.pg_get_functiondef(t.tgfoid)"))
    return {
      rows: [
        ["def", "nspname", "proname", "oid", "args"],
        [TOUCH, "public", "touch", "16404", ""],
      ],
    };
  return undefined;
}

/** A definition the explorer's DDL reads (a view's, a routine's), or undefined. */
function definition(sql: string): Answer | undefined {
  const view =
    /^SELECT pg_catalog\.pg_get_viewdef\(c\.oid, true\) .* n\.nspname = '([^']*)' AND c\.relname = '([^']*)'/u.exec(
      sql,
    );
  if (view) {
    const body = VIEWS[`${view[1]}.${view[2]}`];
    return body === undefined
      ? { rows: [["pg_get_viewdef"]] }
      : { rows: [["pg_get_viewdef"], [body]] };
  }
  const routine = /^SELECT pg_catalog\.pg_get_functiondef\((\d+)::oid\)$/u.exec(sql)?.[1];
  if (routine === "16404") return { rows: [["pg_get_functiondef"], [TOUCH]] };
  if (routine === "16405") return { rows: [["pg_get_functiondef"], [REFUND]] };
  return undefined;
}

const DDL = /^(ALTER|DROP|TRUNCATE|COMMENT|REFRESH|CREATE)\b/iu;

/** A DDL statement's refusal where a real server would refuse it, or undefined. */
function refusal(sql: string): Answer | undefined {
  const drop = /^DROP (TABLE|VIEW|FUNCTION|MATERIALIZED VIEW) ("[^"]*")\.("[^"]*")/u.exec(sql);
  if (drop && !/ CASCADE$/u.test(sql)) {
    const name = `${unquote(drop[2] ?? "")}.${unquote(drop[3] ?? "")}`;
    const oid = name === "public.touch" ? "16404" : name;
    const blocking = (DEPENDENTS[oid] ?? []).filter(([, , b]) => b);
    if (blocking.length)
      return {
        error:
          `cannot drop ${drop[1]?.toLowerCase()} ${name.split(".")[1]} because other objects depend on it\n` +
          `DETAIL:  ${blocking.map(([t, i]) => `${t} ${i} depends on ${drop[1]?.toLowerCase()} ${name.split(".")[1]}`).join("\n")}\n` +
          "HINT:  Use DROP ... CASCADE to drop the dependent objects too.",
      };
  }
  const lines = sql.split("\n");
  const bad = lines.findIndex((line) => /\bFORM\b/u.test(line));
  if (bad >= 0) {
    const shown = lines[bad] ?? "";
    const prefix = `LINE ${bad + 1}: `;
    return {
      error: `syntax error at or near "FORM"\n${prefix}${shown}\n${" ".repeat(prefix.length + shown.indexOf("FORM"))}^`,
    };
  }
  return undefined;
}

/** The scripted server; `other` answers every statement that is not the feature's. */
export function objectsServer(other: Script = () => ({})): ObjectsServer {
  const ran: string[] = [];
  const script: Script = (sql, env) => {
    const text = sql.trim();
    if (!env.PGDATABASE) return other(sql, env);
    const answer = read(text) ?? definition(text);
    if (answer) return answer;
    if (!DDL.test(text)) return other(sql, env);
    // Recorded, refused as a server would, else answered as the rest of the page answers it.
    ran.push(text);
    return refusal(text) ?? other(sql, env);
  };
  return { script, ran };
}
