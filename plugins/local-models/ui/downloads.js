// Downloads: a model's file (or the parts of a split one) fetched by curl into the models folder as
// org/repo/file, resumable (`-C -`) after a pause or a closed window, its progress read from the
// growing .part file, renamed into place when done; or a model pulled into Ollama, its progress from
// Ollama's own stream. Two run at once; the list survives restarts.
import { fileUrl } from "./hub.js";
import { MODELS_DIR } from "./library.js";

/**
 * @typedef {{
 *   id: string,
 *   kind: "file" | "ollama",
 *   name: string,
 *   repo?: string,
 *   files?: string[],
 *   quant?: string,
 *   server?: string,
 *   total: number,
 *   received: number,
 *   speed?: number,
 *   state: "queued" | "running" | "paused" | "done" | "failed",
 *   error?: string,
 *   startedAt: number,
 *   path?: string,
 *   status?: string,
 * }} Download
 */

const RUNNING = 2;
const POLL_MS = 700;

/** Where a repository's file lands. @param {string} repo @param {string} file */
export const targetOf = (repo, file) => `${MODELS_DIR}/${repo}/${file.split("/").pop()}`;
/** A home path as curl sees it from the home folder. @param {string} p */
const fromHome = (p) => (p.startsWith("~/") ? p.slice(2) : p);

/** curl's words for why it stopped. @param {number | undefined} code @param {string} err */
export function curlError(code, err) {
  if (code === 22)
    return /401|403/.test(err)
      ? "Hugging Face refused: the repository may need a sign-in."
      : `The download failed: ${err.split("\n").pop()?.trim() || "an error status"}`;
  if (code === 6 || code === 7) return "Could not reach huggingface.co: is this computer online?";
  if (code === 23) return "Could not write the file: is the disk full?";
  if (code === 28) return "The download stalled.";
  if (code === 56 || code === 18) return "The connection dropped; resume to go on.";
  return err.trim().split("\n").pop() || `curl ended (${code})`;
}

/**
 * @param {{
 *   S: import("./state.js").Store,
 *   bridge: import("./net.js").Bridge,
 *   procs: import("./proc.js").Procs,
 *   store: { get(k: string): Promise<any>, set(k: string, v: unknown): Promise<void> },
 *   pull?: (d: Download, onProgress: (p: { total: number, completed: number, status: string }) => void, signal: AbortSignal) => Promise<void>,
 *   onDone: (d: Download) => void,
 *   toast: (text: string, level?: "info" | "error" | "success") => void,
 * }} deps
 */
export function createDownloads({ S, bridge, procs, store, pull, onDone, toast }) {
  /** @type {Map<string, { stop: () => void }>} */
  const live = new Map();
  /** Downloads asked to pause before their program had started. @type {Set<string>} */
  const pausing = new Set();

  /** @param {(list: Download[]) => Download[]} change */
  const update = (change) => {
    const list = change([...S.get().downloads]);
    S.set({ downloads: list });
    void store.set(
      "downloads",
      list
        .filter((d) => d.state !== "done")
        .map(({ speed: _s, ...rest }) => ({
          ...rest,
          state: rest.state === "running" ? "paused" : rest.state,
        })),
    );
  };
  /** @param {string} id @param {Partial<Download>} patch */
  const patch = (id, patch) =>
    update((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const get = (/** @type {string} */ id) => S.get().downloads.find((d) => d.id === id);

  /** How many bytes are on disk of a file: the finished file or its .part. @param {string} path */
  async function onDisk(path) {
    for (const p of [path, `${path}.part`]) {
      const st = await bridge.call("fs.stat", { path: p }).catch(() => undefined);
      if (st?.size !== undefined) return { size: st.size, done: p === path };
    }
    return { size: 0, done: false };
  }

  /** Fetch one file with curl, resolving once it is complete. @param {Download} d @param {string} file @param {number} before */
  function fetchFile(d, file, before) {
    const path = targetOf(/** @type {string} */ (d.repo), file);
    return new Promise((resolve, reject) => {
      /** @type {string[]} */
      const err = [];
      let last = { at: Date.now(), bytes: before };
      let stopped = false;
      const timer = setInterval(async () => {
        const { size } = await onDisk(path);
        const now = Date.now();
        const received = before + size;
        const speed = ((received - last.bytes) / Math.max(1, now - last.at)) * 1000;
        last = { at: now, bytes: received };
        if (!stopped) patch(d.id, { received, speed: speed > 0 ? speed : get(d.id)?.speed });
      }, POLL_MS);
      procs
        .start(
          "curl",
          [
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "--create-dirs",
            "--retry",
            "2",
            "-C",
            "-",
            "-o",
            `${fromHome(path)}.part`,
            fileUrl(/** @type {string} */ (d.repo), file),
          ],
          {
            cwd: "~",
            onLine: (stream, text) => {
              if (stream === "stderr") err.push(text);
            },
            onExit: async (code) => {
              clearInterval(timer);
              if (stopped) return reject(Object.assign(new Error("paused"), { paused: true }));
              const { size } = await onDisk(path);
              // A file already whole answers a resume with 416, which curl calls 33: it is done.
              if (code === 0 || code === 33) {
                await bridge.call("fs.rename", { from: `${path}.part`, to: path }).catch(() => {});
                resolve(size);
              } else reject(new Error(curlError(code, err.join("\n"))));
            },
          },
        )
        .then((h) => {
          const stop = () => {
            stopped = true;
            void h.kill();
          };
          live.set(d.id, { stop });
          if (pausing.has(d.id)) stop();
        })
        .catch((e) => {
          clearInterval(timer);
          const code = /** @type {{ code?: string }} */ (e)?.code;
          reject(
            new Error(
              code === "not_found"
                ? "curl is not installed, and downloads need it."
                : String(e instanceof Error ? e.message : e),
            ),
          );
        });
    });
  }

  /** @param {Download} d */
  async function run(d) {
    patch(d.id, { state: "running", error: undefined, startedAt: Date.now() });
    try {
      if (d.kind === "ollama") {
        if (!pull) throw new Error("No Ollama to pull into.");
        const controller = new AbortController();
        live.set(d.id, { stop: () => controller.abort() });
        await pull(
          d,
          (p) =>
            patch(d.id, {
              total: p.total || get(d.id)?.total || 0,
              received: p.completed,
              status: p.status,
            }),
          controller.signal,
        );
      } else {
        let done = 0;
        for (const file of d.files ?? []) {
          const path = targetOf(/** @type {string} */ (d.repo), file);
          const already = await onDisk(path);
          if (already.done) {
            done += already.size;
            continue;
          }
          done += await fetchFile(d, file, done);
        }
      }
      live.delete(d.id);
      const finished = {
        ...(get(d.id) ?? d),
        state: /** @type {const} */ ("done"),
        received: get(d.id)?.total ?? d.total,
        speed: undefined,
      };
      patch(d.id, finished);
      onDone(finished);
    } catch (e) {
      live.delete(d.id);
      const paused =
        /** @type {{ paused?: boolean, name?: string }} */ (e)?.paused ||
        /** @type {{ code?: string }} */ (e)?.code === "aborted";
      patch(
        d.id,
        paused
          ? { state: "paused", speed: undefined }
          : {
              state: "failed",
              error: e instanceof Error ? e.message : String(e),
              speed: undefined,
            },
      );
      if (!paused) toast(`${d.name}: ${e instanceof Error ? e.message : e}`, "error");
    }
    next();
  }

  /** Start the queued ones while fewer than RUNNING run. */
  function next() {
    const running = S.get().downloads.filter((d) => d.state === "running").length;
    const queued = S.get().downloads.filter((d) => d.state === "queued");
    for (const d of queued.slice(0, Math.max(0, RUNNING - running))) void run(d);
  }

  /** @param {Omit<Download, "id" | "state" | "received" | "startedAt">} d */
  function add(d) {
    const id = `${d.kind}:${d.repo ?? d.server}:${d.name}`;
    const old = get(id);
    if (old && (old.state === "running" || old.state === "queued")) return old;
    /** @type {Download} */
    const item = { ...d, id, state: "queued", received: old?.received ?? 0, startedAt: Date.now() };
    update((list) => [item, ...list.filter((x) => x.id !== id)]);
    next();
    return item;
  }

  return {
    add,
    /** @param {string} id */
    pause(id) {
      pausing.add(id);
      live.get(id)?.stop();
    },
    /** @param {string} id */
    resume(id) {
      pausing.delete(id);
      patch(id, { state: "queued" });
      next();
    },
    /** Stop and throw away what came. @param {string} id */
    async cancel(id) {
      const d = get(id);
      live.get(id)?.stop();
      if (d?.kind === "file")
        for (const file of d.files ?? [])
          await bridge
            .call("fs.trash", { path: `${targetOf(/** @type {string} */ (d.repo), file)}.part` })
            .catch(() => {});
      update((list) => list.filter((x) => x.id !== id));
    },
    /** Forget a finished or failed one. @param {string} id */
    clear(id) {
      update((list) => list.filter((x) => x.id !== id));
    },
    async start() {
      const saved = await store.get("downloads");
      if (Array.isArray(saved)) S.set({ downloads: saved });
    },
  };
}

/** @typedef {ReturnType<typeof createDownloads>} Downloads */
