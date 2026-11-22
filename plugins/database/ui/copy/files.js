// A COPY's file (PG-23): a sink that writes each chunk as it comes (the first replaces the file, the
// rest append: fs.write `append`, ADR 0356) and a source that reads the file in 1 MiB ranges as
// base64 (fs.read `offset`, `length`), so neither holds the file whole and a chunk may end inside a
// UTF-8 character. Both act on that one path, under the grant the dialog gave (asked again once
// when it is missing, console-files.js). No DOM.

import { readScope, withGrant, writeScope } from "../console-files.js";
import { baseName } from "../console-list.js";
import { bytesOf, COPY_CHUNK } from "./stream.js";

/**
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {import("./stream.js").Sink} Sink
 * @typedef {import("./stream.js").Source} Source
 */

/**
 * The file at `path` as a COPY out's sink.
 * @param {Bridge} bridge
 * @param {string} path
 * @returns {Sink & { path: string }}
 */
export function fileSink(bridge, path) {
  const scope = writeScope(path);
  let started = false;
  const write = (/** @type {string} */ content, /** @type {"utf8" | "base64"} */ encoding) =>
    withGrant(
      bridge,
      scope,
      () =>
        bridge.call("fs.write", {
          path,
          content,
          encoding,
          scope,
          ...(started ? { append: true } : {}),
        }),
      `To write the COPY's rows to ${baseName(path)}`,
    );
  return {
    path,
    async write(chunk) {
      await write(chunk.data, chunk.encoding);
      started = true;
    },
    async close() {
      if (!started) await write("", "utf8");
      started = true;
    },
  };
}

/**
 * The file at `path` as a COPY in's source, its size read first.
 * @param {Bridge} bridge
 * @param {string} path
 * @param {number} [chunk] bytes a read takes
 * @returns {Promise<Source & { path: string }>}
 */
export async function fileSource(bridge, path, chunk = COPY_CHUNK) {
  const scope = readScope(path);
  const reason = `To read ${baseName(path)} for the COPY`;
  const read = (/** @type {number} */ offset, /** @type {number} */ length) =>
    withGrant(
      bridge,
      scope,
      () => bridge.call("fs.read", { path, offset, length, encoding: "base64", scope }),
      reason,
    );
  const size = (await read(0, 0)).size ?? 0;
  let offset = 0;
  return {
    path,
    size,
    async read() {
      if (offset >= size) return undefined;
      const answer = await read(offset, Math.min(chunk, COPY_CHUNK));
      const encoding = answer.encoding === "utf8" ? "utf8" : "base64";
      const bytes = bytesOf(answer.content, encoding);
      if (bytes === 0) return undefined;
      offset += bytes;
      return { data: answer.content, encoding, bytes };
    },
  };
}
