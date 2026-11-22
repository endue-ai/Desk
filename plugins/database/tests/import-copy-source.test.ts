// The COPY source of an import (PG-60): the file read in 1 MiB ranges and never whole, its lines
// handed out in chunks of 1 MiB at most, the rows and bytes it reports, the encodings decoded, a
// batch that stops at its rows and the next one that takes up the rest, and a segment held to be
// sent again.
import { describe, expect, it } from "vitest";
import { COPY_CHUNK, fileSource } from "../ui/copy/index.js";
import { createReader } from "../ui/import-copy/client.js";
import { createRows, replay } from "../ui/import-copy/source.js";
import type { Job } from "../ui/import-copy/transform.js";

const BASE: Job = {
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

/** A bridge whose one file is `bytes`, keeping each read's length. */
function host(bytes: Uint8Array) {
  const reads: number[] = [];
  const bridge = {
    call: async (method: string, params: Record<string, unknown>) => {
      if (method !== "fs.read") throw new Error(method);
      const offset = Number(params.offset ?? 0);
      const length = Number(params.length ?? bytes.length);
      const part = bytes.subarray(offset, offset + length);
      reads.push(part.length);
      let binary = "";
      for (let i = 0; i < part.length; i += 0x8000)
        binary += String.fromCharCode(...part.subarray(i, i + 0x8000));
      return { content: btoa(binary), encoding: "base64", size: bytes.length };
    },
  };
  return { bridge: bridge as never, reads };
}

async function rowsOf(bytes: Uint8Array, job: Job) {
  const { bridge, reads } = host(bytes);
  const reader = createReader();
  await reader.open(job);
  const seen: Array<{ rows: number; bytes: number; total?: number }> = [];
  const file = await fileSource(bridge, "~/data/big.csv");
  const rows = createRows({ file, reader, progress: (p) => seen.push(p) });
  return { rows, reads, seen };
}

async function drain(source: { read(): Promise<{ data: string; bytes: number } | undefined> }) {
  const chunks: Array<{ data: string; bytes: number }> = [];
  for (let c = await source.read(); c; c = await source.read()) chunks.push(c);
  return chunks;
}

describe("an import's COPY source", () => {
  it("reads 6 MiB of CSV in ranges, never whole, and sends it in chunks of 1 MiB at most", async () => {
    const lines = ["id,name"];
    for (let i = 1, length = 0; length < 6 * COPY_CHUNK; i++) {
      const line = `${i},"name ${i}, é"`;
      lines.push(line);
      length += line.length + 1;
    }
    const text = `${lines.join("\n")}\n`;
    const bytes = new TextEncoder().encode(text);
    const { rows, reads, seen } = await rowsOf(bytes, BASE);
    const chunks = await drain(rows.batch(Number.POSITIVE_INFINITY));
    expect(rows.done()).toBe(true);
    expect(Math.max(...reads)).toBeLessThanOrEqual(COPY_CHUNK);
    expect(reads.reduce((a, b) => a + b, 0)).toBe(bytes.length);
    expect(Math.max(...chunks.map((c) => c.bytes))).toBeLessThanOrEqual(COPY_CHUNK);
    const sent = chunks.map((c) => c.data).join("");
    expect(sent.split("\n").length - 1).toBe(lines.length - 1);
    expect(sent.startsWith("1\tname 1, é\n2\tname 2, é\n")).toBe(true);
    expect(seen.at(-1)).toEqual({
      rows: lines.length - 1,
      bytes: bytes.length,
      total: bytes.length,
    });
  });

  it("stops a batch at its rows, and the next batch takes up the rest", async () => {
    const text = "id,name\n1,a\n2,b\n3,c\n4,d\n5,e\n";
    const { rows } = await rowsOf(new TextEncoder().encode(text), BASE);
    const first = (await drain(rows.batch(2))).map((c) => c.data).join("");
    expect(first).toBe("1\ta\n2\tb\n");
    expect(rows.done()).toBe(false);
    const held = { lines: [] as string[], rows: [] as number[] };
    const second = (await drain(rows.batch(2, held))).map((c) => c.data).join("");
    expect(second).toBe("3\tc\n4\td\n");
    expect(held).toEqual({ lines: ["3\tc\n", "4\td\n"], rows: [3, 4] });
    expect((await drain(rows.batch(10))).map((c) => c.data).join("")).toBe("5\te\n");
    expect(rows.done()).toBe(true);
    expect((await drain(replay(held.lines))).map((c) => c.data).join("")).toBe("3\tc\n4\td\n");
  });

  it("decodes windows-1252 and UTF-16LE with its byte order mark", async () => {
    const latin = Uint8Array.from([
      ...new TextEncoder().encode("id,name\n1,"),
      0x5a,
      0x6f,
      0xeb,
      0x0a,
    ]);
    const one = await rowsOf(latin, { ...BASE, encoding: "windows-1252" });
    expect((await drain(one.rows.batch(10))).map((c) => c.data).join("")).toBe("1\tZoë\n");
    const units = "id,name\n2,Zoë\n";
    const wide = new Uint8Array(2 + units.length * 2);
    wide.set([0xff, 0xfe]);
    for (let i = 0; i < units.length; i++) wide[2 + i * 2] = units.charCodeAt(i);
    const two = await rowsOf(wide, { ...BASE, encoding: "utf-16le" });
    expect((await drain(two.rows.batch(10))).map((c) => c.data).join("")).toBe("2\tZoë\n");
  });
});
