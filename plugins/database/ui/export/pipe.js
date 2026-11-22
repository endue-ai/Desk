// One file of a whole export, from the COPY's pages to the bytes fs.write appends (PG-64): the
// server's own CSV or text bytes as they come (a byte order mark first when asked), or COPY's text
// format read back (copy/text.js) and written in the format chosen (stream.js, xlsx-stream.js),
// encoded, and gzipped when asked (deflate.js). It counts the rows it wrote. It runs in the export's
// worker (pipe-worker.js) or, without one, in the frame. No DOM.

import { textReader } from "../copy/text.js";
import { bytesOf, contentOf } from "./bytes.js";
import { deflater } from "./deflate.js";
import { textWriter } from "./stream.js";
import { xlsxWriter } from "./xlsx-stream.js";

/**
 * @typedef {import("./options.js").ExportFormat} ExportFormat
 * @typedef {import("./options.js").ExportOptions} ExportOptions
 * @typedef {import("./stream.js").Meta} Meta
 * @typedef {{ format: ExportFormat, options: ExportOptions, meta: Meta, direct?: "csv" | "text", gzip?: boolean, sheet?: string }} PipeJob
 *   `direct`: the pages are the file's bytes in that COPY format; `sheet`: an .xlsx sheet's name.
 * @typedef {{ data: string, encoding?: "utf8" | "base64" }} Page
 * @typedef {import("./bytes.js").FileContent} Out
 * @typedef {{ push(page: Page): Promise<Out[]>, end(): Promise<Out[]>, rows(): number }} Pipe
 */

const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/** Rows in the server's bytes: line ends, in CSV only outside quotes (`quoted` carries over). */
function rowCounter(/** @type {"csv" | "text"} */ format) {
  let quoted = false;
  return (/** @type {Uint8Array} */ bytes) => {
    let n = 0;
    for (const c of bytes) {
      if (c === 34 && format === "csv") quoted = !quoted;
      else if (c === 10 && !quoted) n++;
    }
    return n;
  };
}

const decode = (/** @type {Page} */ page) =>
  page.encoding === "base64"
    ? Uint8Array.from(atob(page.data), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(page.data);

/** @param {PipeJob} job @returns {Pipe} */
export function createPipe(job) {
  const { format, options: o } = job;
  const zip = job.gzip ? deflater("gzip") : undefined;
  let rows = 0;
  let started = false;
  /** Bytes as fs.write takes them, through gzip when asked. */
  const outOf = async (/** @type {Uint8Array[]} */ parts) => {
    /** @type {Uint8Array[]} */
    let packed = parts;
    if (zip) {
      packed = [];
      for (const part of parts) packed.push(...(await zip.push(part)));
    }
    return packed.filter((p) => p.length).map(contentOf);
  };
  if (job.direct) {
    const count = rowCounter(job.direct);
    return {
      async push(page) {
        const first = !started;
        started = true;
        const bytes = decode(page);
        rows += count(bytes);
        if (!zip && !(first && o.bom) && page.encoding !== "base64")
          return [{ content: page.data, encoding: "utf8", bytes: bytes.length }];
        return outOf([...(first && o.bom ? [BOM] : []), bytes]);
      },
      async end() {
        if (o.header && rows > 0) rows--;
        const head = !started && o.bom ? [BOM] : [];
        started = true;
        return [...(await outOf(head)), ...(zip ? (await zip.end()).map(contentOf) : [])];
      },
      rows: () => rows,
    };
  }
  const reader = textReader();
  const plain = !zip && o.encoding === "utf-8" && !o.bom;
  /** Text in the encoding chosen, the byte order mark once at the start. */
  const encoded = async (/** @type {string} */ text, /** @type {boolean} */ first) => {
    if (!text && !(first && o.bom)) return [];
    if (plain)
      return [
        {
          content: text,
          encoding: /** @type {const} */ ("utf8"),
          bytes: new TextEncoder().encode(text).length,
        },
      ];
    return outOf([bytesOf(text, o.encoding, first && o.bom)]);
  };
  if (format === "xlsx") {
    const book = xlsxWriter(job.meta, o, job.sheet ?? "Sheet 1");
    const write = async (/** @type {import("./stream.js").Row[]} */ batch) => {
      const head = started ? [] : await book.head();
      started = true;
      rows += batch.length;
      return outOf([...head, ...(await book.rows(batch))]);
    };
    return {
      push: (page) => write(reader.push(page.data, page.encoding)),
      async end() {
        const last = await write(reader.end());
        const tail = await outOf(await book.end());
        return [...last, ...tail, ...(zip ? (await zip.end()).map(contentOf) : [])];
      },
      rows: () => rows,
    };
  }
  const writer = textWriter(format, o, job.meta);
  const write = (/** @type {import("./stream.js").Row[]} */ batch, last = false) => {
    const first = !started;
    started = true;
    rows += batch.length;
    return (first ? writer.head() : "") + writer.rows(batch) + (last ? writer.end() : "");
  };
  // The byte order mark goes with the file's first bytes, so it is held until there are some.
  let marked = false;
  const send = async (/** @type {string} */ text) => {
    const first = !marked && text !== "";
    if (first) marked = true;
    return encoded(text, first);
  };
  return {
    push: (page) => send(write(reader.push(page.data, page.encoding))),
    async end() {
      const last = await send(write(reader.end(), true));
      const mark = !marked && o.bom ? await encoded("", true) : [];
      return [...last, ...mark, ...(zip ? (await zip.end()).map(contentOf) : [])];
    },
    rows: () => rows,
  };
}
