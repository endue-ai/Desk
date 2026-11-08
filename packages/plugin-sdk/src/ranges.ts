// Where a file's bytes come from: its fs.url URL with `fetch` and `Range`, or, when the desk will not
// give a URL or the frame cannot fetch it, ranged fs.read calls as base64. Both answer one request at
// a time and at most what was asked; files.ts builds whole reads and cached sources on them.
import type { FsReadPermission } from "@endue-ai/bridge";
import type { PluginBridge } from "./sdk";

/** A file the plugin may read: its bridge path and the fs:read scope that covers it. */
export interface FileRef {
  path: string;
  scope: FsReadPermission;
}

/** One request's answer: bytes from `offset` (maybe fewer than asked), or the whole file. */
export type Part = { bytes: Uint8Array; whole: false } | { body: Response; whole: true };

export interface Ranges {
  /** The file's size when it was opened. */
  readonly size: number;
  /** At most `length` bytes from `offset`; an empty answer means the file ends there. */
  part(offset: number, length: number, signal?: AbortSignal): Promise<Part>;
}

/** The bytes one fs.read call asks for: 4 MiB of file, about 5.6 MB of base64. */
const BRIDGE_PART = 4 * 1024 * 1024;

/** What `signal` stops with: always a DOMException named AbortError. */
export function aborted(signal: AbortSignal | undefined): DOMException {
  const reason = signal?.reason;
  if (reason instanceof DOMException && reason.name === "AbortError") return reason;
  return new DOMException("The read was cancelled.", "AbortError");
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw aborted(signal);
}

const isAbort = (error: unknown) => (error as { name?: unknown } | null)?.name === "AbortError";

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Ranged fs.read calls, as base64. */
async function bridgeRanges(
  bridge: PluginBridge,
  file: FileRef,
  size?: number,
  signal?: AbortSignal,
): Promise<Ranges> {
  const { path, scope } = file;
  const read = async (offset: number, length: number, signal?: AbortSignal) => {
    throwIfAborted(signal);
    try {
      const result = await bridge.call("fs.read", {
        path,
        encoding: "base64",
        offset,
        length,
        scope,
      });
      throwIfAborted(signal);
      return result;
    } catch (error) {
      throw signal?.aborted ? aborted(signal) : error;
    }
  };
  const known = size ?? (await read(0, 0, signal)).size ?? 0;
  return {
    size: known,
    part: async (offset, length, signal) => {
      const { content } = await read(offset, Math.min(length, BRIDGE_PART), signal);
      return { bytes: fromBase64(content), whole: false };
    },
  };
}

/**
 * Open `file` for ranged reads: through fs.url when the desk gives a URL, else fs.read. A URL the
 * frame cannot fetch (an older desk's CSP, a token that ended) falls back to fs.read for good; only
 * an abort and fs.read's own refusal (permission_denied, not_found) reach the caller.
 */
export async function openRanges(
  bridge: PluginBridge,
  file: FileRef,
  signal?: AbortSignal,
): Promise<Ranges> {
  throwIfAborted(signal);
  let url: string;
  let size: number;
  try {
    ({ url, size } = await bridge.call("fs.url", { path: file.path, scope: file.scope }));
  } catch {
    throwIfAborted(signal);
    return bridgeRanges(bridge, file, undefined, signal);
  }
  throwIfAborted(signal);
  let fallback: Promise<Ranges> | undefined;
  const viaBridge = () => {
    fallback ??= bridgeRanges(bridge, file, size);
    return fallback;
  };
  const fetchPart = async (offset: number, length: number, signal?: AbortSignal): Promise<Part> => {
    const end = Math.min(size, offset + length) - 1;
    const headers = { Range: `bytes=${offset}-${end}` };
    const response = await fetch(url, { headers, signal });
    throwIfAborted(signal);
    if (response.status === 206) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      throwIfAborted(signal);
      return { bytes, whole: false };
    }
    if (response.status === 416) return { bytes: new Uint8Array(0), whole: false };
    // The server ignored Range (a data: URL, another server): the body is the whole file.
    if (response.ok) return { body: response, whole: true };
    throw new Error(`${url} answered ${response.status}`);
  };
  return {
    size,
    part: async (offset, length, signal) => {
      throwIfAborted(signal);
      if (offset >= size || length <= 0) return { bytes: new Uint8Array(0), whole: false };
      if (!fallback) {
        try {
          return await fetchPart(offset, length, signal);
        } catch (error) {
          if (isAbort(error) || signal?.aborted) throw aborted(signal);
        }
      }
      return (await viaBridge()).part(offset, length, signal);
    },
  };
}

/**
 * Copy a whole-file body into `into` (as much as fits), calling `onChunk` with the bytes so far
 * after each piece the stream hands over.
 */
export async function drain(
  body: Response,
  into: Uint8Array,
  onChunk: (done: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const reader = body.body?.getReader();
  if (!reader) {
    throwIfAborted(signal);
    const all = new Uint8Array(await body.arrayBuffer());
    throwIfAborted(signal);
    into.set(all.subarray(0, into.length));
    onChunk(Math.min(all.length, into.length));
    return Math.min(all.length, into.length);
  }
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  let done = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const next = await reader.read();
      throwIfAborted(signal);
      if (next.done) break;
      const piece = next.value.subarray(0, Math.max(0, into.length - done));
      into.set(piece, done);
      done += piece.length;
      onChunk(done);
      if (done >= into.length) break;
    }
  } catch (error) {
    throw isAbort(error) || signal?.aborted ? aborted(signal) : error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
  }
  throwIfAborted(signal);
  return done;
}
