import { t } from "../strings/index.js";
// A COPY's rows through the session, in bounded chunks both ways (PG-23): COPY ... TO STDOUT's
// pages (db.fetch, 1 MiB each) go to a sink one at a time, and COPY ... FROM STDIN takes a source's
// chunks (db.copy, 1 MiB at most) until it ends. Nothing holds more than one chunk. A cancel closes
// the COPY out (the core cancels it on the server) or fails the COPY in (CopyFail): between calls no
// statement runs, so db.cancel alone would not reach it. Either way the session is ready after. A
// failed row's error names the file's line, from the server's CONTEXT. No DOM.

/**
 * @typedef {import("@endue-ai/bridge").DbPage} Page
 * @typedef {"utf8" | "base64"} Encoding
 * @typedef {{ data: string, encoding: Encoding, bytes: number }} Chunk
 * @typedef {{ write(chunk: Chunk): Promise<void>, close?(): Promise<void> }} Sink
 *   `close` runs once the COPY ended well (an empty COPY still makes its file).
 * @typedef {{ size?: number, read(): Promise<Chunk | undefined> }} Source
 *   `read` answers the next chunk, at most COPY_CHUNK bytes, or undefined at the end.
 * @typedef {{ bytes: number, total?: number }} Progress
 * @typedef {{ sink?: Sink, source?: Source, name?: string, progress?(p: Progress | null): void }} Copy
 *   What a COPY through standard input or output reads or writes: `sink` for COPY ... TO STDOUT,
 *   `source` for COPY ... FROM STDIN; `name` is the file's, for its error; `progress` hears the
 *   bytes after each chunk, and null at the end.
 */

/** The most bytes one db.copy carries (the core's COPY_CHUNK) and one COPY out page asks for. */
export const COPY_CHUNK = 1024 * 1024;
/** query_canceled, which a COPY the plugin ended answers as a cancel. */
const CANCELED = "57014";
const LINE = /\bline (\d+)\b/u;

/** The bytes a chunk of `data` in `encoding` stands for. */
export function bytesOf(/** @type {string} */ data, /** @type {Encoding} */ encoding) {
  if (encoding === "utf8") return new TextEncoder().encode(data).length;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * Stream a COPY that `first` opened; answers its last page (the tag, or the error).
 * @param {{
 *   call(method: string, params: Record<string, unknown>): Promise<any>,
 *   sessionId: string | undefined, first: Page, copy: Copy, stopped(): boolean,
 *   heard(page: Page): Page,
 * }} run `stopped` says the run was cancelled; `heard` takes each page's notices and state.
 * @returns {Promise<Page>}
 */
export async function streamCopy(run) {
  const { copy, first } = run;
  try {
    if (first.copy?.direction === "out") return await out(run);
    return withLine(await into(run), copy.name);
  } finally {
    copy.progress?.(null);
  }
}

/** COPY ... TO STDOUT into the sink, page by page. @param {Parameters<typeof streamCopy>[0]} run */
async function out({ call, sessionId, first, copy, stopped, heard }) {
  const sink = copy.sink;
  if (!sink) {
    heard(await call("db.fetch", { sessionId, close: true }));
    throw new Error(t("copy.stream.theCopyHasNowhereToWrite"));
  }
  let page = first;
  let bytes = 0;
  for (;;) {
    if (page.data) {
      const encoding = page.encoding ?? "utf8";
      const size = bytesOf(page.data, encoding);
      try {
        await sink.write({ data: page.data, encoding, bytes: size });
      } catch (failure) {
        if (page.more) await call("db.fetch", { sessionId, close: true }).catch(() => {});
        throw failure;
      }
      bytes += size;
      copy.progress?.({ bytes });
    }
    if (!page.more) break;
    if (stopped()) return cancelled(heard(await call("db.fetch", { sessionId, close: true })));
    page = heard(await call("db.fetch", { sessionId, pageBytes: COPY_CHUNK }));
  }
  if (!page.error) await sink.close?.();
  return page;
}

/** COPY ... FROM STDIN from the source, chunk by chunk. @param {Parameters<typeof streamCopy>[0]} run */
async function into({ call, sessionId, copy, stopped, heard }) {
  const source = copy.source;
  const send = async (/** @type {Record<string, unknown>} */ params) =>
    heard(await call("db.copy", { sessionId, ...params }));
  if (!source) return send({ fail: "the COPY has nothing to read" });
  const total = source.size;
  let bytes = 0;
  for (;;) {
    if (stopped()) return send({ fail: "cancelled" });
    /** @type {Chunk | undefined} */
    let chunk;
    try {
      chunk = await source.read();
    } catch (failure) {
      return send({ fail: failure instanceof Error ? failure.message : String(failure) });
    }
    if (!chunk) return send({ done: true });
    const page = await send({ data: chunk.data, encoding: chunk.encoding });
    // A bad row ends the COPY early, with its error.
    if (!page.more) return page;
    bytes += chunk.bytes;
    copy.progress?.(total === undefined ? { bytes } : { bytes, total });
  }
}

/** A page the plugin ended by its cancel, as the server's cancel would read. */
function cancelled(/** @type {Page} */ page) {
  if (page.error) return page;
  const error = { severity: "ERROR", code: CANCELED, message: t("copy.stream.copyCancelled") };
  return /** @type {Page} */ ({ ...page, error });
}

/** A failed COPY in's error led by the file's line the server names (`COPY t, line 3`). */
function withLine(/** @type {Page} */ page, /** @type {string | undefined} */ name) {
  const error = page.error;
  const line = error?.where ? LINE.exec(error.where)?.[1] : undefined;
  if (!error || !line || error.code === CANCELED) return page;
  const where = name ? `${name}, line ${line}` : `Line ${line}`;
  return { ...page, error: { ...error, message: `${where}: ${error.message}` } };
}
