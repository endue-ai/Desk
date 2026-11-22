// The COPY stream (PG-23, ui/copy/stream.js) on a scripted session: COPY out page by page into a
// sink and COPY in chunk by chunk from a source, each at most 1 MiB, with progress after each; a bad
// row's error led by the file's line; a cancel that closes the COPY out or fails the COPY in.
import { describe, expect, it } from "vitest";
import type { DbPage } from "../../../packages/bridge/src/index";
import { fileSink, fileSource } from "../ui/copy/index.js";
import { bytesOf, type Chunk, COPY_CHUNK, streamCopy } from "../ui/copy/stream.js";

type Call = { method: string; params: Record<string, unknown> };

/** A COPY out of `pages` pages of `size` bytes each, as the core answers db.fetch. */
function outServer(pages: number, size: number) {
  const calls: Call[] = [];
  let sent = 1;
  const pageOf = (at: number, more: boolean): DbPage => ({
    rows: [],
    more,
    data: `${String(at).padStart(size - 1, "x")}\n`,
    encoding: "utf8",
    ...(more ? {} : { tag: `COPY ${pages}`, rowCount: pages, transaction: "idle" }),
  });
  const call = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method !== "db.fetch") throw new Error(`unexpected ${method}`);
    if (params.close) return { rows: [], more: false, transaction: "idle" };
    sent += 1;
    return pageOf(sent, sent < pages);
  };
  const first: DbPage = {
    ...pageOf(1, true),
    copy: { direction: "out", format: "text", columns: 1 },
  };
  return { calls, call, first };
}

/** A COPY in that takes every chunk, failing at `bad` (a 1-based line) when given. */
function inServer(bad?: number) {
  const calls: Call[] = [];
  let lines = 0;
  const call = async (method: string, params: Record<string, unknown>): Promise<DbPage> => {
    calls.push({ method, params });
    if (params.fail)
      return {
        rows: [],
        more: false,
        error: {
          severity: "ERROR",
          code: "57014",
          message: `COPY from stdin failed: ${params.fail}`,
        } as never,
      };
    const data =
      params.encoding === "base64" ? atob(String(params.data ?? "")) : String(params.data ?? "");
    lines += data.split("\n").length - 1;
    if (bad && lines >= bad)
      return {
        rows: [],
        more: false,
        error: {
          severity: "ERROR",
          code: "22P02",
          message: 'invalid input syntax for type integer: "x"',
          where: `COPY items, line ${bad}, column id: "x"`,
        } as never,
      };
    if (params.done) return { rows: [], more: false, tag: `COPY ${lines}`, rowCount: lines };
    return { rows: [], more: true };
  };
  const first: DbPage = {
    rows: [],
    more: true,
    copy: { direction: "in", format: "text", columns: 2 },
  };
  return { calls, call, first };
}

const keep = (page: DbPage) => page;

describe("the COPY stream", () => {
  it("writes a COPY out page by page, asking 1 MiB pages, with progress after each", async () => {
    const server = outServer(5, 1000);
    const written: Chunk[] = [];
    const progress: unknown[] = [];
    const last = await streamCopy({
      call: server.call,
      sessionId: "s1",
      first: server.first,
      copy: {
        sink: { write: async (c) => void written.push(c) },
        progress: (p) => progress.push(p),
      },
      stopped: () => false,
      heard: keep,
    });
    expect(last).toMatchObject({ tag: "COPY 5", more: false });
    expect(written.map((c) => c.bytes)).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(server.calls.every((c) => c.params.pageBytes === COPY_CHUNK)).toBe(true);
    expect(progress).toEqual([
      { bytes: 1000 },
      { bytes: 2000 },
      { bytes: 3000 },
      { bytes: 4000 },
      { bytes: 5000 },
      null,
    ]);
  });

  it("a cancel closes the COPY out and reads as the server's cancel", async () => {
    const server = outServer(100, 10);
    let pages = 0;
    const last = await streamCopy({
      call: server.call,
      sessionId: "s1",
      first: server.first,
      copy: { sink: { write: async () => void pages++ } },
      stopped: () => pages >= 3,
      heard: keep,
    });
    expect(pages).toBe(3);
    expect(server.calls.at(-1)).toEqual({
      method: "db.fetch",
      params: { sessionId: "s1", close: true },
    });
    expect(last.error).toMatchObject({ code: "57014" });
  });

  it("sends a COPY in in chunks of 1 MiB at most, then CopyDone", async () => {
    const server = inServer();
    const text = "1\tone\n".repeat(400_000);
    const files = { "~/rows.txt": text };
    const bridge = fakeFiles(files);
    const source = await fileSource(bridge, "~/rows.txt");
    const progress: unknown[] = [];
    const last = await streamCopy({
      call: server.call,
      sessionId: "s1",
      first: server.first,
      copy: { source, progress: (p) => progress.push(p) },
      stopped: () => false,
      heard: keep,
    });
    expect(last).toMatchObject({ tag: "COPY 400000" });
    const sent = server.calls.filter((c) => c.params.data !== undefined);
    expect(sent.length).toBe(Math.ceil(text.length / COPY_CHUNK));
    for (const c of sent)
      expect(bytesOf(String(c.params.data), "base64")).toBeLessThanOrEqual(COPY_CHUNK);
    expect(server.calls.at(-1)?.params).toEqual({ sessionId: "s1", done: true });
    expect(progress.at(-2)).toEqual({ bytes: text.length, total: text.length });
  });

  it("a bad row ends the COPY in with the file's line, and a cancel fails it", async () => {
    const bad = inServer(3);
    const lines = ["1\tone", "2\ttwo", "x\tbad", "4\tfour"].join("\n");
    const source = await fileSource(fakeFiles({ "~/items.txt": lines }), "~/items.txt", 8);
    const failed = await streamCopy({
      call: bad.call,
      sessionId: "s1",
      first: bad.first,
      copy: { source, name: "items.txt" },
      stopped: () => false,
      heard: keep,
    });
    expect(failed.error?.message).toBe(
      'items.txt, line 3: invalid input syntax for type integer: "x"',
    );
    const stopped = inServer();
    const cancelled = await streamCopy({
      call: stopped.call,
      sessionId: "s1",
      first: stopped.first,
      copy: { source: await fileSource(fakeFiles({ "~/a": lines }), "~/a", 8), name: "a" },
      stopped: () => stopped.calls.length >= 2,
      heard: keep,
    });
    expect(stopped.calls.at(-1)?.params).toEqual({ sessionId: "s1", fail: "cancelled" });
    expect(cancelled.error).toMatchObject({ code: "57014" });
  });

  it("the file sink replaces the file first and appends after, and makes an empty COPY's file", async () => {
    const files: Record<string, string> = { "~/out.txt": "old" };
    const bridge = fakeFiles(files);
    const sink = fileSink(bridge, "~/out.txt");
    await sink.write({ data: "1\n", encoding: "utf8", bytes: 2 });
    await sink.write({ data: btoa("2\n"), encoding: "base64", bytes: 2 });
    await sink.close?.();
    expect(files["~/out.txt"]).toBe("1\n2\n");
    const empty = fileSink(bridge, "~/empty.txt");
    await empty.close?.();
    expect(files["~/empty.txt"]).toBe("");
  });
});

/** fs.read ranges and fs.write (with append) over `files`, as the core answers them. */
function fakeFiles(files: Record<string, string>) {
  return {
    call: async (method: string, params: Record<string, unknown>) => {
      const path = String(params.path);
      if (method === "fs.read") {
        const bytes = new TextEncoder().encode(files[path] ?? "");
        const offset = Number(params.offset ?? 0);
        const part = bytes.subarray(offset, offset + Number(params.length ?? bytes.length));
        let binary = "";
        for (let at = 0; at < part.length; at += 8192)
          binary += String.fromCharCode(...part.subarray(at, at + 8192));
        return { content: btoa(binary), encoding: "base64", size: bytes.length };
      }
      if (method === "fs.write") {
        const content =
          params.encoding === "base64" ? atob(String(params.content)) : String(params.content);
        if (params.append && files[path] === undefined)
          throw Object.assign(new Error("gone"), { code: "not_found" });
        files[path] = params.append ? `${files[path]}${content}` : content;
        return { bytesWritten: content.length };
      }
      throw new Error(`unexpected ${method}`);
    },
  } as never;
}
