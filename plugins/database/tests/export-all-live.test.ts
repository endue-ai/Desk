// A whole export on a real server (PG-64), through the desk core's sessions and its files
// (core-bridge.ts: the core grants the file a test names, as the dialog would; the rename and the
// trash are the test's own). Ten million rows (EXPORT_ALL_ROWS to size it down) go to a file twice:
// as the server's CSV and through the plugin's own writer, each file's SHA-256 equal to the one
// computed from the rows' formula and the plugin's heap far below the file's size; the server's CSV
// equals the plugin's writer on values that need quoting and escaping; a schema's tables go to a
// folder, gzipped. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database.
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { textReader } from "../ui/copy/text.js";
import type { Connection } from "../ui/engines/common.js";
import { optionsOf } from "../ui/export/options.js";
import { textWriter } from "../ui/export/stream.js";
import { sharedCore } from "./core-bridge";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue export-all");
const LIVE = (uri ? normalize({ ...fields, id: "c-live-all", name: "live" }) : {}) as Connection;
const ROWS = Number(process.env.EXPORT_ALL_ROWS ?? 10_000_000);
const folder = mkdtempSync(join(tmpdir(), "desk-export-all-"));
setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const heap = () => {
  gc();
  return process.memoryUsage().heapUsed;
};

type Watch = { writes: number; heap: number };

/** The plugin on the real core, its save dialog answering `file`, its folder dialog `dir`. */
async function live(answer: { file?: string; dir?: string }, watch: Watch): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const core = sharedCore();
  const real = (path: string) => path;
  const m = await mount({
    store: { connections: [LIVE] },
    handlers: {
      ...procs.handlers,
      "dialog.save": () => ({ cancelled: false, path: answer.file ?? "" }),
      "dialog.open": () => ({ cancelled: false, paths: [answer.dir ?? ""] }),
      "fs.write": async (params) => {
        watch.writes++;
        if (watch.writes % 64 === 1) watch.heap = Math.max(watch.heap, heap());
        const done = await core.call("fs.write", params);
        params.content = "";
        return done;
      },
      "fs.rename": ({ from, to }) => {
        renameSync(real(from), real(to));
        return { crossedDevices: false };
      },
      "fs.trash": ({ path }) => {
        rmSync(real(path), { force: true });
        return {};
      },
    },
  });
  procs.attach((event) => m.host.emit(event));
  return m;
}

const pad = (n: number) => String(n).padStart(2, "0");
const START = Date.UTC(2026, 0, 1);
/** Row g as the server's CSV writes it, the line ending given. */
function line(g: number, eol: string) {
  const at = new Date(START + g * 1000);
  const stamp = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
  const label = g % 1000 === 0 ? "" : g % 7 === 0 ? `"row ${g}, seven"` : `row ${g}`;
  return `${g},${label},${(g * 7) % 10000},${stamp}${eol}`;
}
/** The SHA-256 of the file the rows make. */
function expected(eol: string) {
  const hash = createHash("sha256");
  hash.update(`id,label,amount,at${eol}`);
  let piece = "";
  for (let g = 1; g <= ROWS; g++) {
    piece += line(g, eol);
    if (piece.length > 1 << 20) {
      hash.update(piece);
      piece = "";
    }
  }
  hash.update(piece);
  return hash.digest("hex");
}
const sha = (path: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

describe.skipIf(!uri)("a whole export on a real server", () => {
  beforeAll(async () => {
    await server.end();
    await server.admin("DROP TABLE IF EXISTS export_big, export_odd, export_two");
    await server.admin("CREATE TABLE export_big (id int8, label text, amount int4, at timestamp)");
    await server.admin(
      `INSERT INTO export_big SELECT g, CASE WHEN g % 1000 = 0 THEN NULL WHEN g % 7 = 0 THEN 'row ' || g || ', seven' ELSE 'row ' || g END, g * 7 % 10000, timestamp '2026-01-01' + g * interval '1 second' FROM generate_series(1, ${ROWS}) g`,
    );
    await server.admin("CREATE TABLE export_odd (id int4, v text, n numeric)");
    await server.admin(
      `INSERT INTO export_odd VALUES (1, '', 1.5), (2, NULL, NULL), (3, 'say "hi", then' || chr(10) || 'leave', -0.25), (4, E'tab\\there \\\\ back', 1e20), (5, 'é ü 漢 😀', 0), (6, '\\.', 7), (7, ',', 8), (8, E'cr\\rlf', 9)`,
    );
    await server.admin("CREATE TABLE export_two (k int4 PRIMARY KEY, v text)");
    await server.admin(
      "INSERT INTO export_two SELECT g, 'two ' || g FROM generate_series(1, 1000) g",
    );
  }, 900_000);
  afterAll(async () => {
    await server.end();
    await server.admin("DROP TABLE IF EXISTS export_big, export_odd, export_two");
    rmSync(folder, { recursive: true, force: true });
  });

  it("ten million rows to a file with flat memory and a matching checksum", async () => {
    for (const [name, options, eol] of [
      ["server", { lineEnding: "lf" }, "\n"],
      ["writer", { lineEnding: "crlf" }, "\r\n"],
    ] as const) {
      const file = join(folder, `big-${name}.csv`);
      const watch = { writes: 0, heap: 0 };
      const m = await live({ file }, watch);
      const before = heap();
      const began = Date.now();
      const done = (await m.host.command("endue.database.export-all", {
        connection: "live",
        table: "export_big",
        format: "csv",
        options,
      })) as { rows: number; files: { direct: boolean; bytes: number }[] };
      const ms = Date.now() - began;
      expect(done.rows).toBe(ROWS);
      expect(done.files[0]?.direct).toBe(name === "server");
      const size = statSync(file).size;
      expect(done.files[0]?.bytes).toBe(size);
      expect(await sha(file)).toBe(expected(eol));
      const grew = watch.heap - before;
      expect(grew).toBeLessThan(Math.max(64 * 1024 * 1024, size / 8));
      console.info(
        `${name}: ${ROWS} rows, ${(size / 1048576).toFixed(1)} MiB in ${ms} ms, ${watch.writes} writes; heap peak +${(grew / 1048576).toFixed(1)} MiB`,
      );
      rmSync(file, { force: true });
    }
  }, 1_800_000);

  it("the server's CSV equals the plugin's writer where it is used", async () => {
    const csv = join(folder, "odd.csv");
    const tsv = join(folder, "odd.tsv");
    const m = await live({ file: csv }, { writes: 0, heap: 0 });
    const args = { connection: "live", table: "export_odd" };
    await m.host.command("endue.database.export-all", {
      ...args,
      format: "csv",
      options: { lineEnding: "lf" },
    });
    const n = await live({ file: tsv }, { writes: 0, heap: 0 });
    await n.host.command("endue.database.export-all", { ...args, format: "tsv" });
    // The text format read back and written as CSV by the plugin's writer.
    const reader = textReader();
    const rows = [...reader.push(readFileSync(tsv, "utf8")), ...reader.end()];
    const meta = {
      columns: ["id", "v", "n"],
      oids: [23, 25, 1700],
      types: ["integer", "text", "numeric"],
    };
    const w = textWriter("csv", optionsOf("csv", { lineEnding: "lf" }), meta);
    expect(w.head() + w.rows(rows) + w.end()).toBe(readFileSync(csv, "utf8"));
    expect(rows).toHaveLength(8);
  });

  it("a schema's tables go to a folder, one gzipped file each", async () => {
    const dir = mkdtempSync(join(folder, "tables-"));
    const m = await live({ dir }, { writes: 0, heap: 0 });
    const done = (await m.host.command("endue.database.export-tables", {
      connection: "live",
      schema: "public",
      tables: ["export_odd", "export_two"],
      format: "json",
      compress: true,
    })) as { files: { path: string; rows: number }[] };
    expect(done.files.map((f) => f.rows)).toEqual([8, 1000]);
    const two = JSON.parse(
      gunzipSync(readFileSync(join(dir, "export_two.json.gz"))).toString("utf8"),
    );
    expect(two).toHaveLength(1000);
    expect(two[999]).toEqual({ k: 1000, v: "two 1000" });
    // The export's transaction ended: no session of this database is left in one.
    const open = await server.admin(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'",
    );
    expect(Number(open)).toBe(0);
  });
});
