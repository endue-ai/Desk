// The worker that opens large files off the main thread: the text of a large page and the
// archives (MHTML, web archives, WARC, MAFF), which need no DOM. The model goes back without
// functions: an archive page's resolver stays here, under an id, and answers the main thread's
// loads; a page beside its files on disk goes back marked, for the main thread to read its files
// itself. This module imports only relative files: import maps do not reach a module worker.
import { openFile } from "./formats.js";

/**
 * @typedef {import("./formats.js").Model} Model
 * @typedef {import("./formats.js").Resolver} Resolver
 * @typedef {{ base: string, local?: string, remote?: number }} PackedResolver
 * @typedef {{ type: "open", bytes: Uint8Array, path: string }
 *   | { type: "load", id: number, resolver: number, url: string }} Request
 * @typedef {(message: unknown, transfer?: Transferable[]) => void} Post
 */

/** The disk a worker has: none. Pages on disk are marked and read by the main thread. */
const NO_DISK = { read: async () => null };

/**
 * The objects of a model that hold a page (and maybe its source): the model itself, or its entries.
 * @param {Model} model
 * @returns {Array<{ page?: import("./formats.js").PageInput, source?: string, sameSource?: boolean }>}
 */
export function holdersOf(model) {
  if (model.kind === "page") return [model];
  if (model.kind === "entries") return model.entries;
  return [];
}

/**
 * The worker's side: answers "open" with the packed model and "load" with a resource's bytes.
 * @param {Post} post
 * @returns {(request: Request) => Promise<void>}
 */
export function createServer(post) {
  /** @type {Map<number, Resolver>} */
  const resolvers = new Map();
  /** @type {Map<Resolver, number>} */
  const ids = new Map();

  /** Replace each page's resolver by what crosses to the main thread. @param {Model} model */
  const pack = (model) => {
    for (const holder of holdersOf(model)) {
      const page = holder.page;
      if (!page) continue;
      const { resolver } = page;
      /** @type {PackedResolver} */
      let packed;
      if (resolver.local !== undefined) packed = { base: resolver.base, local: resolver.local };
      else {
        let id = ids.get(resolver);
        if (id === undefined) {
          id = ids.size + 1;
          ids.set(resolver, id);
          resolvers.set(id, resolver);
        }
        packed = { base: resolver.base, remote: id };
      }
      holder.page = {
        ...page,
        resolver: /** @type {Resolver} */ (/** @type {unknown} */ (packed)),
      };
      // The source is usually the page's text: it crosses once.
      if (holder.source !== undefined && holder.source === page.text) {
        delete holder.source;
        holder.sameSource = true;
      }
    }
    return model;
  };

  return async (request) => {
    if (request.type === "open") {
      try {
        const model = await openFile(request.bytes, request.path, NO_DISK);
        post({ type: "opened", model: pack(model) });
      } catch (error) {
        post({ type: "failed", message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (request.type === "load") {
      const resolver = resolvers.get(request.resolver);
      /** @type {Awaited<ReturnType<Resolver["load"]>>} */
      let got = "missing";
      try {
        if (resolver) got = await resolver.load(request.url);
      } catch {}
      if (typeof got === "string") post({ type: "loaded", id: request.id, got });
      else {
        // A copy: the archive keeps its own bytes for the next load of the same URL.
        const bytes = got.bytes.slice();
        post({ type: "loaded", id: request.id, got: { bytes, type: got.type } }, [bytes.buffer]);
      }
    }
  };
}

if (typeof document === "undefined" && typeof globalThis.postMessage === "function") {
  const scope = /** @type {{ postMessage: Post, onmessage: unknown }} */ (
    /** @type {unknown} */ (globalThis)
  );
  const serve = createServer((message, transfer = []) => scope.postMessage(message, transfer));
  scope.onmessage = (/** @type {MessageEvent<Request>} */ event) => void serve(event.data);
}
