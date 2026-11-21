// The scripted pg_dump and pg_restore (ui/features/backup/): what each prints for its arguments, in
// its real words. pg_dump says its verbose steps, a table's rows for each of the fixture's three
// tables, and fails as pg_dump does when a --table pattern matches nothing; pg_restore --list
// answers the fixture archive's list (a path holding `plain` is a plain SQL file, one holding `bad`
// is not an archive at all), and a restore says each entry it makes. The unit tests' harness and
// the runtime e2e page (packages/runtime/e2e/fixture/database.ts) share it; it needs no Node.
import { StubError, type StubHandlers } from "../../../packages/bridge/src/index";
import type { Reply } from "./clients";

/** What `--version` prints, for a program by its last path part. */
export const PROGRAM_VERSIONS: Record<string, string> = {
  pg_dump: "pg_dump (PostgreSQL) 17.6\n",
  pg_restore: "pg_restore (PostgreSQL) 17.6\n",
};

const TABLES = ["public.orders", "public.customers", "sales.items"];

/** The fixture archive's list, as pg_restore 17 prints it. */
export const FIXTURE_TOC = [
  ";",
  "; Archive created at 2026-11-21 09:30:00 UTC",
  ";     dbname: warehouse",
  ";     TOC Entries: 9",
  ";     Compression: gzip",
  ";     Dump Version: 1.16-0",
  ";     Format: CUSTOM",
  ";     Integer: 4 bytes",
  ";     Offset: 8 bytes",
  ";     Dumped from database version: 17.6",
  ";     Dumped by pg_dump version: 17.6",
  ";",
  ";",
  "; Selected TOC Entries:",
  ";",
  "6; 2615 16390 SCHEMA - sales app",
  "218; 1259 16384 TABLE public orders app",
  "219; 1259 16388 TABLE public customers app",
  "220; 1259 16392 TABLE sales items app",
  "3440; 0 0 COMMENT public TABLE orders app",
  "3432; 0 16384 TABLE DATA public orders app",
  "3433; 0 16388 TABLE DATA public customers app",
  "3434; 0 16392 TABLE DATA sales items app",
  "3284; 2606 16386 CONSTRAINT public orders orders_pkey app",
  "",
].join("\n");

const value = (args: string[], name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** pg_dump's answer: its verbose steps on standard error, the file named by --file written. */
export function pgDumpRun(args: string[]): Reply {
  const patterns = args.filter((a) => a.startsWith("--table=")).map((a) => a.slice(8));
  const missing = patterns.find((p) => !TABLES.includes(p) && !p.endsWith("*"));
  if (missing)
    return {
      stdout: "",
      stderr: `pg_dump: error: no matching tables were found for pattern "${missing}"\n`,
      code: 1,
    };
  const schemas = args
    .filter((a) => a.startsWith("--schema="))
    .map((a) => a.slice(9).replace(/^"|"$/gu, ""));
  const tables = TABLES.filter(
    (t) =>
      (!patterns.length || patterns.includes(t)) &&
      (!schemas.length || schemas.includes(t.split(".")[0] ?? "")),
  );
  const schemaOnly = args.includes("--schema-only");
  // A plain file says "processing data" for each table, and "dumping contents" unless INSERTs.
  const plain = args.includes("--format=plain");
  const said = (t: string) => [
    ...(plain ? [`pg_dump: processing data for table "${t}"`] : []),
    ...(plain && args.includes("--inserts") ? [] : [`pg_dump: dumping contents of table "${t}"`]),
  ];
  const lines = [
    "pg_dump: last built-in OID is 16383",
    "pg_dump: reading extensions",
    "pg_dump: reading schemas",
    "pg_dump: reading user-defined tables",
    ...(schemaOnly ? [] : tables.flatMap(said)),
  ];
  return { stdout: "", stderr: `${lines.join("\n")}\n`, code: 0 };
}

/** What pg_restore --verbose says for each entry of the fixture archive, by its id. */
const RESTORED: Record<number, string> = {
  6: 'pg_restore: creating SCHEMA "sales"',
  218: 'pg_restore: creating TABLE "public.orders"',
  219: 'pg_restore: creating TABLE "public.customers"',
  220: 'pg_restore: creating TABLE "sales.items"',
  3440: 'pg_restore: creating COMMENT "public.TABLE orders"',
  3432: 'pg_restore: processing data for table "public.orders"',
  3433: 'pg_restore: processing data for table "public.customers"',
  3434: 'pg_restore: processing data for table "sales.items"',
  3284: 'pg_restore: creating CONSTRAINT "public.orders orders_pkey"',
};

/** The text of a --use-list file, where the page holds its files (backupHandlers). */
let readList: (path: string) => string | undefined = () => undefined;

/** pg_restore's answer: the list, or a restore's verbose lines for the entries it makes. */
export function pgRestoreRun(args: string[]): Reply {
  const path = args.at(-1) ?? "";
  if (/plain/u.test(path))
    return {
      stdout: "",
      stderr: "pg_restore: error: input file appears to be a text format dump. Please use psql.\n",
      code: 1,
    };
  if (/bad/u.test(path))
    return {
      stdout: "",
      stderr: "pg_restore: error: input file does not appear to be a valid archive\n",
      code: 1,
    };
  if (args[0] === "--list") return { stdout: FIXTURE_TOC, stderr: "", code: 0 };
  const list = value(args, "use-list");
  const chosen = list === undefined ? undefined : readList(list);
  const ids = chosen?.split("\n").map((l) => Number(/^(\d+);/u.exec(l)?.[1]));
  const made = Object.entries(RESTORED)
    .filter(([id]) => !ids || ids.includes(Number(id)))
    .map(([, line]) => line);
  const lines = ["pg_restore: connecting to database for restore", ...made];
  return { stdout: "", stderr: `${lines.join("\n")}\n`, code: 0 };
}

/** The scripted answer of pg_dump or pg_restore, by the program's last path part; else undefined. */
export function programReply(command: string, args: string[]): Reply | undefined {
  const name = command.split("/").at(-1) ?? command;
  if (name !== "pg_dump" && name !== "pg_restore") return undefined;
  if (args[0] === "--version") return { stdout: PROGRAM_VERSIONS[name] ?? "", stderr: "", code: 0 };
  return name === "pg_dump" ? pgDumpRun(args) : pgRestoreRun(args);
}

/**
 * The desk's side of a backup on the e2e page, over its files in memory: the save dialog names
 * `~/Backups/<suggested name>`, the open dialog the fixture archive (written there first), fs.stat
 * says what is there, and pg_dump's --file is written when the scripted pg_dump runs.
 */
export function backupHandlers(
  files: Record<string, string>,
  spawn: NonNullable<StubHandlers["proc.spawn"]>,
): StubHandlers {
  files["~/Backups/warehouse.dump"] = "PGDMP fixture archive\n";
  readList = (path) => files[path.replace(/^\.\//u, "~/")];
  return {
    "dialog.save": ({ suggestedName }) => ({
      cancelled: false,
      path: `~/Backups/${suggestedName}`,
    }),
    "dialog.open": () => ({ cancelled: false, paths: ["~/Backups/warehouse.dump"] }),
    "fs.stat": ({ path }) => {
      const text = files[path];
      if (text === undefined) throw new StubError("not_found", `${path}: no such file`);
      return { kind: "file", size: new TextEncoder().encode(text).length, readOnly: false };
    },
    "proc.spawn": (params, caller) => {
      const name = params.command.split("/").at(-1);
      const file = params.args?.find((a) => a.startsWith("--file=./"))?.slice(9);
      if (name === "pg_dump" && file) files[`~/${file}`] = "PGDMP fixture archive\n".repeat(900);
      return spawn(params, caller);
    },
  };
}
