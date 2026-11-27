import { t } from "../strings/index.js";
// The frame's side of the map's worker (PG-46): one worker for every map and value viewer of the
// page, started with the SDK's startWorker the first time a shape is asked for; each request gets
// its reply as a promise. Without a worker (unit tests, a frame that cannot start one) the same
// engine answers in the frame. When the worker stops, what was in flight fails and `generation`
// moves on, so the maps read their values again.

/**
 * @typedef {import("./engine.js").Request} Request
 * @typedef {import("./engine.js").Reply} Reply
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{ ask(request: DistributiveOmit<Request, "id">): Promise<Reply>, readonly generation: number }} GeoClient
 */
/** @template T @typedef {T extends unknown ? Omit<T, "id"> : never} DistributiveOmit */

/** @param {StartWorker | undefined} startWorker */
export function createGeoClient(startWorker) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;
  let generation = 0;
  /** @type {Map<number, { resolve(reply: Reply): void, reject(error: unknown): void }>} */
  const pending = new Map();
  /** @type {Promise<ReturnType<typeof import("./engine.js").createEngine>> | undefined} */
  let local;

  const stop = (/** @type {unknown} */ error) => {
    worker?.terminate();
    worker = undefined;
    generation++;
    const failed = [...pending.values()];
    pending.clear();
    for (const entry of failed) entry.reject(error);
  };
  const started = () => {
    if (worker || !startWorker) return worker;
    try {
      worker = startWorker(new URL("./worker.js", import.meta.url), { name: "Database map" });
    } catch {
      return undefined;
    }
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (typeof data.error === "string") entry.reject(new Error(data.error));
      else entry.resolve(data);
    };
    worker.onerror = (event) =>
      stop(new Error(event.message || t("geo.client.theMapSWorkerStopped")));
    return worker;
  };

  /** @type {GeoClient} */
  const client = {
    get generation() {
      return generation;
    },
    async ask(request) {
      const id = ++next;
      const to = started();
      if (to)
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          to.postMessage({ ...request, id });
        });
      local ??= import("./engine.js").then((m) => m.createEngine());
      const { reply } = (await local).answer(/** @type {Request} */ ({ ...request, id }));
      if (typeof reply.error === "string") throw new Error(reply.error);
      return reply;
    },
  };
  return client;
}

/** @type {WeakMap<StartWorker, GeoClient>} */
const shared = new WeakMap();
/** @type {GeoClient | undefined} */
let inFrame;

/** The page's one client for a worker starter (one for the frame when there is none). */
export function geoClient(/** @type {StartWorker | undefined} */ startWorker) {
  if (!startWorker) {
    inFrame ??= createGeoClient(undefined);
    return inFrame;
  }
  let client = shared.get(startWorker);
  if (!client) {
    client = createGeoClient(startWorker);
    shared.set(startWorker, client);
  }
  return client;
}
