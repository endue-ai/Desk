// Where the window keeps things: threads as one JSON file each under ~/.endue/local-models/threads
// with an index beside them (the desk's store holds 64 KiB a value, too little for conversations),
// and small preferences in the desk's store. Writes are coalesced so a streaming answer saves once
// it settles, not on every token.

export const HOME = "~/.endue/local-models";
export const THREADS = `${HOME}/threads`;
export const INDEX = `${HOME}/threads.json`;
const readScope = { permission: "fs:read", paths: [`${HOME}/**`] };
const writeScope = { permission: "fs:write", paths: [`${HOME}/**`] };

/**
 * @typedef {import("./net.js").Bridge} Bridge
 * @typedef {import("./threads.js").Thread} Thread
 * @typedef {import("./threads.js").ThreadEntry} ThreadEntry
 */

const codeOf = (/** @type {unknown} */ e) => /** @type {{ code?: string }} */ (e)?.code ?? "";

/** @param {Bridge} bridge */
export function createStore(bridge, { delayMs = 400 } = {}) {
  /** @type {Map<string, { timer: ReturnType<typeof setTimeout>, write: () => Promise<void> }>} */
  const pending = new Map();

  /** @param {string} path @param {unknown} value */
  const writeJson = (path, value) =>
    bridge.call("fs.write", {
      path,
      content: `${JSON.stringify(value, null, 1)}\n`,
      encoding: "utf8",
      createDirs: true,
      scope: writeScope,
    });

  /** @param {string} path */
  const readJson = async (path) => {
    try {
      const answer = await bridge.call("fs.read", { path, encoding: "utf8", scope: readScope });
      return JSON.parse(answer.content);
    } catch (error) {
      if (codeOf(error) === "not_found") return undefined;
      throw error;
    }
  };

  /** Write later, the last value for a path winning. @param {string} path @param {() => unknown} value */
  const later = (path, value) => {
    const old = pending.get(path);
    if (old) clearTimeout(old.timer);
    const write = async () => {
      pending.delete(path);
      await writeJson(path, value());
    };
    pending.set(path, { timer: setTimeout(() => void write().catch(() => {}), delayMs), write });
  };

  return {
    bridge,
    readJson,
    writeJson,
    /** The thread list, newest first. @returns {Promise<ThreadEntry[]>} */
    async index() {
      const entries = await readJson(INDEX).catch(() => undefined);
      return Array.isArray(entries?.threads) ? entries.threads : [];
    },
    /** @param {ThreadEntry[]} entries */
    saveIndex(entries) {
      later(INDEX, () => ({ version: 1, threads: entries }));
    },
    /** @param {string} id @returns {Promise<Thread | undefined>} */
    async thread(id) {
      return readJson(`${THREADS}/${id}.json`);
    },
    /** @param {Thread} thread @param {{ now?: boolean }} [options] */
    async saveThread(thread, options = {}) {
      const path = `${THREADS}/${thread.id}.json`;
      if (options.now) {
        const old = pending.get(path);
        if (old) clearTimeout(old.timer);
        pending.delete(path);
        await writeJson(path, thread);
      } else later(path, () => thread);
    },
    /** To the trash, never deleted for good. @param {string} id */
    async removeThread(id) {
      const path = `${THREADS}/${id}.json`;
      const old = pending.get(path);
      if (old) clearTimeout(old.timer);
      pending.delete(path);
      await bridge.call("fs.trash", { path, scope: writeScope }).catch((error) => {
        if (codeOf(error) !== "not_found") throw error;
      });
    },
    /** Write everything still waiting. */
    async flush() {
      await Promise.all(
        [...pending.values()].map((p) => {
          clearTimeout(p.timer);
          return p.write();
        }),
      );
    },
    /** A small value in the desk's store. @param {string} key */
    async get(key) {
      const answer = await bridge.call("store.get", { key }).catch(() => undefined);
      return answer?.value;
    },
    /** @param {string} key @param {unknown} value */
    async set(key, value) {
      await bridge.call("store.set", { key, value }).catch(() => {});
    },
  };
}
