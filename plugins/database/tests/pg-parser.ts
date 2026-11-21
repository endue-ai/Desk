// The SQL parser in Node for the tests: the vendored wasm read from the plugin's folder, as the
// parse worker fetches it (ADR 0283), and a small schema model of fixture names.
import { readFileSync } from "node:fs";
import type { SchemaModel } from "../ui/sql/parse/model.js";
import { createParse } from "../ui/sql/parse/parse.js";
import { loadLibpgQuery } from "../ui/sql/parse/wasm.js";

export const WASM = new URL("../ui/vendor/libpg-query.wasm", import.meta.url);

let loaded: Promise<ReturnType<typeof createParse>> | undefined;

/** One parser for a test file. */
export function loadParse() {
  loaded ??= loadLibpgQuery(readFileSync(WASM)).then(createParse);
  return loaded;
}

const columns = (...names: string[]) => names.map((name) => ({ name, type: "integer" }));

/** public (tables, a view, functions), app (its own people) and a schema whose objects are unread. */
export const MODEL: SchemaModel = {
  schemas: [
    {
      name: "public",
      relations: [
        { name: "people", kind: "table", columns: columns("id", "name", "note") },
        { name: "orders", kind: "table", columns: columns("id", "person", "total") },
        { name: "big_orders", kind: "view", columns: columns("id", "total") },
        { name: "unread_columns", kind: "table" },
        { name: "Odd Name", kind: "table", columns: columns("Id") },
      ],
      routines: [
        { name: "touch", kind: "function", args: "" },
        { name: "add", kind: "function", args: "a integer, b integer" },
        { name: "add", kind: "function", args: "a numeric, b numeric" },
      ],
    },
    {
      name: "app",
      relations: [{ name: "people", kind: "table", columns: columns("id", "email") }],
      routines: [],
    },
    { name: "later" },
  ],
};
