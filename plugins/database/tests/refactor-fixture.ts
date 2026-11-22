// A scripted server's answers to an object's rename (PG-33, ui/refactor/read-sql.js) for the shop
// (pg-catalog.ts): `people` is a plain table, one PL/pgSQL function names its column `name`, and the
// dependency catalog lists the view `named` that follows. Every other statement goes to the script
// behind it. Fixture data only; it needs no Node.
import type { Answer, Script } from "./clients";

/** The rename's statements answered, or undefined for any other. */
export function renameAnswer(sql: string): Answer | undefined {
  if (sql.startsWith("SELECT c.relkind::text"))
    return {
      rows: [
        ["relkind", "elsewhere", "holders", "overloads"],
        ["r", "0", "", "[]"],
      ],
    };
  if (sql.startsWith("SELECT n.nspname AS schema, p.proname AS name"))
    return {
      rows: [
        [
          "schema",
          "name",
          "args",
          "kind",
          "lanname",
          "prosrc",
          "def",
          "names",
          "triggers",
          "config",
        ],
        [
          "public",
          "shout",
          "",
          "function",
          "plpgsql",
          " BEGIN UPDATE people SET name = upper(name); END ",
          "CREATE OR REPLACE FUNCTION public.shout()\n RETURNS void\n LANGUAGE plpgsql\nAS $function$ BEGIN UPDATE people SET name = upper(name); END $function$\n",
          "[]",
          "[]",
          "",
        ],
      ],
    };
  if (sql.includes("FROM pg_depend d JOIN target t"))
    return {
      rows: [
        ["kind", "schema", "name", "on_table", "detail"],
        ["view", "public", "named", "", ""],
      ],
    };
  return undefined;
}

/** A script that answers the rename's statements before `base`. */
export const renameServer =
  (base: Script): Script =>
  (sql, who) =>
    renameAnswer(sql) ?? base(sql, who);
