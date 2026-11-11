// Opening a file, or an entry one level down, as a level: what it is (formats/index.js), then its
// reader, endue.formats' in the library worker when one starts and in the frame otherwise. A file
// it cannot show becomes a details level with the sentence why; so does a cancelled opening. An
// opener runs each as long work on the progress element, and opens again the levels a sleep kept.
import { formatSize } from "./bytes.js";
import { MEMORY_LIMIT } from "./extract.js";
import { nameOf } from "./files.js";
import { detectFormat, inLibrary, openDetected } from "./formats/index.js";
import { applyLevel } from "./keep.js";
import { connect, openRemote, startLibraryWorker, unavailable } from "./library-client.js";
import { memorySource } from "./source.js";
import { buildTree } from "./tree.js";

/**
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Job} Job
 * @typedef {import("./source.js").Source} Source
 * @typedef {import("./library-client.js").StartWorker} StartWorker
 * @typedef {import("./formats/archive.js").Entry} Entry
 * @typedef {import("./keep.js").KeptLevel} KeptLevel
 * @typedef {{ name: string, format: string, archive?: Archive, note?: string,
 *   tree: ReturnType<typeof buildTree>, expanded: Set<string>, marked: Set<string>,
 *   selected: string | null, from?: string }} Level `from`: the entry of the level above it was
 *   opened from (none for the file itself)
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

/**
 * Opening as long work on the progress element: a file's first level, the archive in an entry as
 * the level below, and the levels a sleep kept.
 * @param {{
 *   jobs: ReturnType<typeof import("./jobs.js").createJobs>,
 *   reading: ReturnType<typeof import("./previews.js").createPreviews>["reading"],
 *   startWorker?: StartWorker,
 * }} how
 */
export function createOpener({ jobs, reading, startWorker }) {
  /**
   * Open `source` as a level, as a job: the bytes read so far say how far a long listing is.
   * @param {Source} source @param {string} name
   */
  const opening = (source, name) =>
    jobs.run(`Opening ${name}`, "", async (job) => {
      let read = 0;
      let done = false;
      /** @type {Source} */
      const counted = {
        size: source.size,
        read: async (offset, length) => {
          const bytes = await source.read(offset, length);
          read += bytes.length;
          if (!done) job.report(null, 1, `${formatSize(read)} read`);
          return bytes;
        },
      };
      try {
        return await openLevel(counted, name, { startWorker, job });
      } finally {
        done = true;
      }
    });

  /** The archive in `entry`, read whole, as the level below. @param {Archive} archive @param {Entry} entry @param {string} id */
  const openInner = async (archive, entry, id) => {
    const bytes = await reading(archive, entry, Infinity, `Reading ${nameOf(id)}`);
    const inner = await opening(memorySource(bytes), nameOf(id));
    inner.from = id;
    return inner;
  };

  /**
   * Put back what a sleep kept of a file's levels: the first one's place, then each level below
   * opened again from its entry in the one above, until one does not open.
   * @param {Level[]} levels the file's, its first level open @param {KeptLevel[]} kept
   */
  const reopen = async (levels, [first, ...below]) => {
    if (levels[0]) applyLevel(levels[0], first);
    for (const level of below) {
      const at = levels.at(-1);
      const entry = level.from === undefined ? undefined : at?.tree.byId.get(level.from)?.entry;
      if (!at?.archive || !entry || entry.kind !== "file" || entry.size > MEMORY_LIMIT) return;
      const inner = await openInner(at.archive, entry, /** @type {string} */ (level.from)).catch(
        () => undefined,
      );
      if (!inner?.archive) return inner && closeLevels([inner]);
      applyLevel(inner, level);
      levels.push(inner);
    }
  };

  return { opening, openInner, reopen };
}
