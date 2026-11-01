// Reading files without base64 through the bridge (ADR 0048): readBytes for a whole file, with
// progress and a signal, and byteSource for formats that read only parts (a zip's directory, an mp4's
// atoms). Both go through the file's fs.url URL with `fetch` and `Range`, and fall back to ranged
// fs.read calls where the desk gives no URL (ranges.ts).
import { aborted, drain, type FileRef, openRanges, type Ranges, throwIfAborted } from "./ranges";
import type { PluginContext } from "./sdk";

export type { FileRef } from "./ranges";

/** Bytes per request: one part of the desk's file URLs (MAX_PART in the app's file_urls.rs). */
export const CHUNK = 2 * 1024 * 1024;
/** Requests in flight at once while a whole file is read. */
const PARALLEL = 4;
/** The cache's block, how many it keeps, and the read (in blocks) that skips it. */
const BLOCK = 64 * 1024;
const KEEP = 64;
const LONG = KEEP / 2;

export interface ReadBytesOptions {
  /** Called after each chunk with the bytes read so far and the file's size. */
  onProgress?(done: number, total: number): void;
  /** Stops the read: it rejects with a DOMException named AbortError and asks for nothing more. */
  signal?: AbortSignal;
}

/** Random access to a file: `read` answers exactly min(length, size - offset) bytes. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

const shorter = (path: string) => new Error(`${path} got shorter while it was read.`);

/**
 * The whole file at `path`, read in chunks of 2 MiB through its fs.url URL (`fetch` with `Range`,
 * four at a time), or through ranged fs.read calls when the desk gives no URL. Rejects as fs.read
 * does when the plugin may not read it (a `BridgeCallError`, `permission_denied`).
 */
export async function readBytes(
  ctx: Pick<PluginContext, "bridge">,
  file: FileRef,
  options: ReadBytesOptions = {},
): Promise<Uint8Array> {
  const { onProgress, signal } = options;
  const stop = new AbortController();
  const onAbort = () => stop.abort(aborted(signal));
  signal?.addEventListener("abort", onAbort);
  try {
    if (signal?.aborted) onAbort();
    const ranges = await openRanges(ctx.bridge, file, stop.signal);
    const { size } = ranges;
    const out = new Uint8Array(size);
    let done = 0;
    const report = (bytes: number) => {
      done += bytes;
      onProgress?.(done, size);
    };
    /** Fill out[start, end); true when the answer was the whole file, now all in `out`. */
    const fill = async (start: number, end: number): Promise<boolean> => {
      for (let at = start; at < end; ) {
        const got = await ranges.part(at, end - at, stop.signal);
        if (got.whole && start === 0 && done === 0) {
          const sent = await drain(
            got.body,
            out,
            (bytes) => onProgress?.(bytes, size),
            stop.signal,
          );
          if (sent < size) throw shorter(file.path);
          return true;
        }
        // A whole file where a range was asked for, after ranges were answered: take the range.
        const bytes = got.whole
          ? new Uint8Array(await got.body.arrayBuffer()).subarray(at, end)
          : got.bytes;
        if (bytes.length === 0) throw shorter(file.path);
        const piece = bytes.subarray(0, end - at);
        out.set(piece, at);
        at += piece.length;
        report(piece.length);
      }
      return false;
    };
    if (size === 0) return out;
    // The first chunk alone: a server that ignores Range sends the whole file to it.
    if (await fill(0, Math.min(CHUNK, size))) return out;
    let next = CHUNK;
    const pull = async () => {
      while (next < size) {
        throwIfAborted(stop.signal);
        const start = next;
        next += CHUNK;
        await fill(start, Math.min(size, start + CHUNK));
      }
    };
    await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        pull().catch((error: unknown) => {
          stop.abort(aborted(signal));
          throw error;
        }),
      ),
    );
    throwIfAborted(signal);
    return out;
  } catch (error) {
    throw signal?.aborted ? aborted(signal) : error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Random access to the file at `path` through its fs.url URL (or ranged fs.read calls), with a
 * cache of 64 blocks of 64 KiB, so a format's neighbouring reads ask the desk once. A read of
 * 2 MiB or more goes straight through. The signal stops all current and future reads, including
 * cache hits. The source has the shape `endue.archives` reads.
 */
export async function byteSource(
  ctx: Pick<PluginContext, "bridge">,
  file: FileRef,
  options: { signal?: AbortSignal } = {},
): Promise<ByteSource> {
  const ranges = await openRanges(ctx.bridge, file, options.signal);
  throwIfAborted(options.signal);
  return cachedSource(ranges, file.path, options.signal);
}

function cachedSource(ranges: Ranges, path: string, signal?: AbortSignal): ByteSource {
  const { size } = ranges;
  const blocks = new Map<number, Uint8Array>();
  /** The whole file, once a server answered a range with all of it. */
  let memory: Uint8Array | undefined;
  const keep = (index: number, block: Uint8Array) => {
    blocks.delete(index);
    blocks.set(index, block);
    while (blocks.size > KEEP) blocks.delete(blocks.keys().next().value as number);
  };
  /** Bytes [start, end) from the desk, request after request. */
  const exact = async (start: number, end: number): Promise<Uint8Array> => {
    const out = new Uint8Array(end - start);
    for (let at = start; at < end; ) {
      throwIfAborted(signal);
      if (memory) {
        out.set(memory.subarray(at, end), at - start);
        break;
      }
      const got = await ranges.part(at, end - at, signal);
      throwIfAborted(signal);
      if (got.whole) {
        const all = new Uint8Array(size);
        if ((await drain(got.body, all, () => {}, signal)) < size) throw shorter(path);
        memory = all;
        continue;
      }
      if (got.bytes.length === 0) throw shorter(path);
      const piece = got.bytes.subarray(0, end - at);
      out.set(piece, at - start);
      at += piece.length;
    }
    return out;
  };
  const wholeFile = () => memory;
  /** Blocks on their way from the desk: concurrent reads of one block share its request. */
  const inflight = new Map<number, Promise<Uint8Array>>();
  /** Ask for blocks index..until in one request; each block enters the cache when it arrives. */
  const fetchRun = (index: number, until: number) => {
    const run = exact(index * BLOCK, Math.min(size, (until + 1) * BLOCK));
    for (let i = index; i <= until; i++) {
      const block = run.then((got) => got.subarray((i - index) * BLOCK, (i - index + 1) * BLOCK));
      inflight.set(i, block);
      block.then(
        (bytes) => {
          if (inflight.get(i) !== block) return;
          inflight.delete(i);
          keep(i, bytes);
        },
        () => {
          if (inflight.get(i) === block) inflight.delete(i);
        },
      );
    }
  };
  return {
    size,
    read: async (offset, length) => {
      throwIfAborted(signal);
      const start = Math.max(0, Math.min(offset, size));
      const end = Math.min(size, start + Math.max(0, length));
      if (end <= start) return new Uint8Array(0);
      if (memory) return memory.slice(start, end);
      const first = Math.floor(start / BLOCK);
      const last = Math.floor((end - 1) / BLOCK);
      if (last - first >= LONG) return exact(start, end);
      // The read holds its own blocks: the cache may evict them while it waits for the others.
      const mine: Array<Uint8Array | Promise<Uint8Array>> = [];
      for (let index = first; index <= last; index++) {
        const cached = blocks.get(index);
        if (cached) {
          keep(index, cached);
          mine.push(cached);
          continue;
        }
        if (!inflight.has(index)) {
          let until = index;
          while (until < last && !blocks.has(until + 1) && !inflight.has(until + 1)) until++;
          fetchRun(index, until);
        }
        mine.push(inflight.get(index) as Promise<Uint8Array>);
      }
      const out = new Uint8Array(end - start);
      for (let index = first; index <= last; index++) {
        const block = await mine[index - first];
        throwIfAborted(signal);
        // A whole-file answer may have arrived while this read waited.
        const whole = wholeFile();
        if (whole) return whole.slice(start, end);
        if (!block) throw shorter(path);
        const from = Math.max(start, index * BLOCK);
        const to = Math.min(end, (index + 1) * BLOCK);
        out.set(block.subarray(from - index * BLOCK, to - index * BLOCK), from - start);
      }
      return out;
    },
  };
}
