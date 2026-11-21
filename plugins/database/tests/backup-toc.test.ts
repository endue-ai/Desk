// What pg_restore --list says of an archive (PG-62): its header and entries, the list file of the
// chosen entries pg_restore reads back, a plain SQL file told apart by pg_restore's own words, and
// a long list read in its worker.
import { describe, expect, it } from "vitest";
import { entryOf, errorWords, isPlain, listFile, parseToc } from "../ui/features/backup/toc.js";
import { readToc } from "../ui/features/backup/toc-reader.js";
import { answer } from "../ui/features/backup/toc-worker.js";
import { FIXTURE_TOC } from "./backup-fixture";

describe("pg_restore --list", () => {
  it("reads pg_restore --list", () => {
    const toc = parseToc(FIXTURE_TOC);
    expect(toc).toMatchObject({
      format: "custom",
      database: "warehouse",
      from: "17.6",
      by: "17.6",
    });
    expect(toc.entries.map(({ line: _line, ...e }) => e)).toEqual([
      { id: 6, kind: "SCHEMA", schema: "", name: "sales", owner: "app" },
      { id: 218, kind: "TABLE", schema: "public", name: "orders", owner: "app" },
      { id: 219, kind: "TABLE", schema: "public", name: "customers", owner: "app" },
      { id: 220, kind: "TABLE", schema: "sales", name: "items", owner: "app" },
      { id: 3440, kind: "COMMENT", schema: "public", name: "TABLE orders", owner: "app" },
      { id: 3432, kind: "TABLE DATA", schema: "public", name: "orders", owner: "app" },
      { id: 3433, kind: "TABLE DATA", schema: "public", name: "customers", owner: "app" },
      { id: 3434, kind: "TABLE DATA", schema: "sales", name: "items", owner: "app" },
      { id: 3284, kind: "CONSTRAINT", schema: "public", name: "orders orders_pkey", owner: "app" },
    ]);
    // Kinds of more than one word, matched longest first; a directory archive's header.
    expect(
      entryOf("3290; 2606 16400 FK CONSTRAINT public items items_order_fkey app"),
    ).toMatchObject({ kind: "FK CONSTRAINT", schema: "public", name: "items items_order_fkey" });
    expect(entryOf("3500; 0 0 MATERIALIZED VIEW DATA public totals app")?.kind).toBe(
      "MATERIALIZED VIEW DATA",
    );
    expect(entryOf("; 218; 1259 16384 TABLE public orders app")).toBeUndefined();
    expect(parseToc(";     Format: DIRECTORY\r\n").format).toBe("directory");
    expect(parseToc("not a list").format).toBe("");
  });

  it("writes the list file of the chosen entries in the archive's order", () => {
    const toc = parseToc(FIXTURE_TOC);
    expect(listFile(toc.entries, [3432, 218])).toBe(
      "; Chosen in endue Desk: 2 of 9 entries\n" +
        "218; 1259 16384 TABLE public orders app\n" +
        "3432; 0 16384 TABLE DATA public orders app\n",
    );
  });

  it("tells a plain SQL file from an archive by pg_restore's own words", () => {
    const plain =
      "pg_restore: error: input file appears to be a text format dump. Please use psql.\n";
    expect(isPlain(plain)).toBe(true);
    expect(isPlain("pg_restore: error: input file does not appear to be a valid archive\n")).toBe(
      false,
    );
    expect(
      errorWords(
        'pg_restore: connecting to database for restore\npg_restore: error: could not connect: FATAL:  database "x" does not exist\n',
        "pg_restore",
      ),
    ).toBe('could not connect: FATAL:  database "x" does not exist');
    expect(errorWords("pg_dump: dumping contents of table\nsomething odd\n", "pg_dump")).toBe(
      "something odd",
    );
  });

  it("reads a long list in its worker and a short one in place", async () => {
    const long =
      FIXTURE_TOC +
      Array.from(
        { length: 3000 },
        (_, i) => `${10_000 + i}; 1259 ${20_000 + i} TABLE public t${i} app`,
      ).join("\n");
    const bytes = new TextEncoder().encode(long);
    expect(answer({ id: 1, bytes })).toMatchObject({ id: 1, toc: { format: "custom" } });
    const started: string[] = [];
    const startWorker = (url: URL) => {
      started.push(url.pathname.split("/").at(-1) ?? "");
      const worker = {
        onmessage: null as null | ((event: { data: unknown }) => void),
        onerror: null,
        terminate: () => {},
        postMessage: (data: { id: number; bytes: Uint8Array }) =>
          setTimeout(() => worker.onmessage?.({ data: answer(data) }), 0),
      };
      return worker as unknown as Worker;
    };
    const read = await readToc(bytes, startWorker);
    expect(read.entries).toHaveLength(9 + 3000);
    expect(started).toEqual(["toc-worker.js"]);
    await readToc(new TextEncoder().encode(FIXTURE_TOC), startWorker);
    expect(started).toHaveLength(1);
  });
});
