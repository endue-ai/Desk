// Opening a file, or an entry one level down, as a level: what it is (formats/index.js), then its
// reader, endue.formats' in the library worker when one starts and in the frame otherwise. A file
// it cannot show becomes a details level with the sentence why; so does a cancelled opening.
import { detectFormat, inLibrary, openDetected } from "./formats/index.js";
import { connect, openRemote, startLibraryWorker, unavailable } from "./library-client.js";
import { buildTree } from "./tree.js";

/**
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Job} Job
 * @typedef {import("./source.js").Source} Source
 * @typedef {import("./library-client.js").StartWorker} StartWorker
 * @typedef {{ name: string, format: string, archive?: Archive, note?: string,
 *   tree: ReturnType<typeof buildTree>, expanded: Set<string>, marked: Set<string>,
 *   selected: string | null }} Level
 */

export const NOT_ARCHIVE = "This is not an archive, package or disk image that Archives reads.";

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
const aborted = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";

/** A level for an opened archive, or for a file shown as details only. @param {string} name @param {string} format @param {Archive} [archive] @param {string} [note] */
export function level(name, format, archive, note) {
  const tree = buildTree(archive?.entries ?? []);
  /** @type {Level} */
  const made = { name, format, tree, expanded: new Set(), marked: new Set(), selected: null };
  // A lone folder at the top (a project folder, usr/share/doc/...) opens, down to where it branches.
  for (let node = tree.root; node.children.length === 1 && node.children[0]?.kind === "folder"; ) {
    node = /** @type {typeof node} */ (node.children[0]);
    made.expanded.add(node.id);
  }
  if (archive) made.archive = archive;
  const why = note ?? archive?.note;
  if (why) made.note = why;
  return made;
}

/** Rejects with an AbortError when `signal` fires. @param {AbortSignal} signal @returns {Promise<never>} */
const until = (signal) =>
  new Promise((_, reject) => {
    const fail = () => reject(new DOMException("The work was cancelled.", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });

/** @param {Source} source @param {string} name @param {{ key: string, label: string }} kind @param {StartWorker | undefined} startWorker @param {Job} job */
async function readerOf(source, name, kind, startWorker, job) {
  if (inLibrary(kind)) {
    const worker = await startLibraryWorker(startWorker);
    if (worker) {
      const link = connect(worker, source);
      try {
        return await openRemote(link, source, kind, job);
      } catch (error) {
        link.close();
        if (!unavailable(error)) throw error;
      }
    }
  }
  return openDetected(source, name, kind, job);
}

/**
 * Open `source` as whatever it is; a file this plugin cannot show becomes a details level.
 * @param {Source} source @param {string} name
 * @param {{ startWorker?: StartWorker, job?: Job }} [options]
 * @returns {Promise<Level>}
 */
export async function openLevel(source, name, { startWorker, job = {} } = {}) {
  const kind = await detectFormat(source, name).catch(() => null);
  if (!kind) return level(name, "Unknown", undefined, NOT_ARCHIVE);
  try {
    const work = readerOf(source, name, kind, startWorker, job);
    // A cancel answers at once, also where the reader does not stop; what it opens later is closed.
    work.then(
      (late) => job.signal?.aborted && late.close?.(),
      () => {},
    );
    const archive = await (job.signal ? Promise.race([work, until(job.signal)]) : work);
    return level(name, archive.format, archive);
  } catch (error) {
    if (job.signal?.aborted || aborted(error))
      return level(name, kind.label, undefined, `Listing ${name} was cancelled.`);
    const why = message(error);
    return level(name, kind.label, undefined, /\.$/.test(why) ? why : `${why}.`);
  }
}

/** End what the levels hold open (their library workers). @param {Level[]} levels */
export const closeLevels = (levels) => {
  for (const at of levels) at.archive?.close?.();
};
