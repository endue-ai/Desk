// An import's run on its session (PG-60), against a server played by a fake executor: BEGIN, the
// date order, CREATE TABLE and COPY, then COMMIT; batches commit every N rows; a refused row rolls
// everything back with its line, or in skip mode goes to the reject file with the server's reason
// while the rest of its segment is sent again; Cancel rolls back; the session is forgotten after.
import { describe, expect, it } from "vitest";
import { createReader } from "../ui/import-copy/client.js";
import { createRejects } from "../ui/import-copy/rejects.js";
import { runCopy } from "../ui/import-copy/run.js";
import { createRows } from "../ui/import-copy/source.js";
import type { Job } from "../ui/import-copy/transform.js";
import { PG } from "./session-helpers";

const JOB: Job = {
  format: "csv",
  encoding: "utf-8",
  delimiter: ",",
  quote: '"',
  escape: '"',
  nullText: "",
  trim: false,
  header: true,
  skip: 0,
  keys: [],
  pick: [0, 1],
};

type Source = { read(): Promise<{ data: string } | undefined> };
type Options = { copy?: { source?: Source }; signal?: AbortSignal; session?: { owner: string } };

/** A server that runs what it is sent, keeps the rows COPY took, and refuses a value `bad`. */
function server(options: { refuse?: RegExp; abort?: AbortController } = {}) {
  const ran: string[] = [];
  let open: string[] = [];
  const saved: string[] = [];
  const table: string[] = [];
  let mark = 0;
  const ok = (affected: number | null = null) => ({
    result: { statements: [{ index: 0, ran: true, sets: [], affected }], notices: [], ms: 1 },
  });
  const failed = (message: string, kind = "sql") => ({
    result: {
      statements: [{ index: 0, ran: true, sets: [], affected: null, error: { kind, message } }],
      notices: [],
      ms: 1,
    },
  });
  const execute = async (_conn: unknown, sql: string, opts: Options = {}) => {
    ran.push(sql.startsWith("COPY") ? "COPY" : sql);
    if (sql === "BEGIN") open = [];
    else if (sql === "COMMIT") table.push(...open.splice(0));
    else if (sql === "ROLLBACK") open = [];
    else if (sql.startsWith("SAVEPOINT")) mark = open.length;
    else if (sql.startsWith("ROLLBACK TO")) open.splice(mark);
    else if (sql.startsWith("COPY") && opts.copy?.source) {
      const lines: string[] = [];
      let text = "";
      for (let c = await opts.copy.source.read(); c; c = await opts.copy.source.read()) {
        text += c.data;
        options.abort?.abort();
        if (opts.signal?.aborted) return failed("COPY from stdin failed: cancelled", "cancelled");
      }
      for (const line of text.split("\n").slice(0, -1)) {
        lines.push(line);
        if (options.refuse?.test(line))
          return failed(`Line ${lines.length}: invalid input syntax for type integer: "bad"`);
      }
      open.push(...lines);
      return ok(lines.length);
    }
    saved.push(sql);
    return ok();
  };
  return { execute: execute as never, ran, table, saved };
}

async function rowsOf(text: string) {
  const reader = createReader();
  await reader.open(JOB);
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const file = {
    size: bytes.length,
    async read() {
      if (at >= bytes.length) return undefined;
      const part = bytes.subarray(at, at + 7);
      at += part.length;
      return {
        data: btoa(String.fromCharCode(...part)),
        encoding: "base64" as const,
        bytes: part.length,
      };
    },
  };
  return createRows({ file, reader });
}

const FILE = "id,name\n1,a\n2,b\nbad,c\n4,d\n5,e\n";
const forgot: string[] = [];
const base = (s: ReturnType<typeof server>) => ({
  execute: s.execute,
  conn: PG,
  owner: { owner: "import:run:1", kind: "console" as const },
  signal: new AbortController().signal,
  begin: ["SET LOCAL DateStyle = 'ISO, DMY'"],
  copy: 'COPY "public"."t" ("id", "name") FROM STDIN',
  batch: 0,
  forget: (owner: string) => void forgot.push(owner),
});

describe("an import's run", () => {
  it("creates the table and copies every row in one transaction", async () => {
    const s = server();
    const done = await runCopy({
      ...base(s),
      create: 'CREATE TABLE "public"."t" ("id" integer, "name" text)',
      rows: await rowsOf("id,name\n1,a\n2,b\n"),
    });
    expect(done).toEqual({ ok: true, rows: 2, rejected: 0, batches: 1, message: "" });
    expect(s.ran).toEqual([
      "BEGIN",
      "SET LOCAL DateStyle = 'ISO, DMY'",
      'CREATE TABLE "public"."t" ("id" integer, "name" text)',
      "COPY",
      "COMMIT",
    ]);
    expect(s.table).toEqual(["1\ta", "2\tb"]);
    expect(forgot.at(-1)).toBe("import:run:1");
  });

  it("commits every N rows in batches", async () => {
    const s = server();
    const done = await runCopy({
      ...base(s),
      batch: 2,
      rows: await rowsOf("id,name\n1,a\n2,b\n3,c\n4,d\n5,e\n"),
    });
    expect(done).toMatchObject({ ok: true, rows: 5, batches: 3 });
    expect(s.ran.filter((sql) => sql === "COMMIT")).toHaveLength(3);
    expect(s.table).toHaveLength(5);
  });

  it("rolls back on a refused row and says its line", async () => {
    const s = server({ refuse: /^bad/u });
    const done = await runCopy({ ...base(s), rows: await rowsOf(FILE) });
    expect(done).toMatchObject({
      ok: false,
      rows: 0,
      message: 'Line 3: invalid input syntax for type integer: "bad"',
    });
    expect(s.ran.at(-1)).toBe("ROLLBACK");
    expect(s.table).toEqual([]);
  });

  it("keeps the batches committed before a failure", async () => {
    const s = server({ refuse: /^bad/u });
    const done = await runCopy({ ...base(s), batch: 2, rows: await rowsOf(FILE) });
    expect(done).toMatchObject({ ok: false, rows: 2, batches: 1 });
    expect(s.table).toEqual(["1\ta", "2\tb"]);
  });

  it("in skip mode writes a refused row and its reason to the reject file, and keeps the rest", async () => {
    const s = server({ refuse: /^bad/u });
    const written: string[] = [];
    const rejects = createRejects({ write: async (c) => void written.push(c.data) }, [
      "id",
      "name",
    ]);
    const done = await runCopy({ ...base(s), rejects, rows: await rowsOf(FILE) });
    expect(done).toMatchObject({ ok: true, rows: 4, rejected: 1 });
    expect(s.table).toEqual(["1\ta", "2\tb", "4\td", "5\te"]);
    expect(s.ran).toContain("ROLLBACK TO SAVEPOINT desk_import");
    expect(written.join("")).toBe(
      'row,reason,id,name\n3,"invalid input syntax for type integer: ""bad""",bad,c\n',
    );
  });

  it("rolls back on Cancel", async () => {
    const abort = new AbortController();
    const s = server({ abort });
    const done = await runCopy({ ...base(s), signal: abort.signal, rows: await rowsOf(FILE) });
    expect(done).toMatchObject({ ok: false, rows: 0 });
    expect(s.ran.at(-1)).toBe("ROLLBACK");
    expect(s.table).toEqual([]);
  });
});
