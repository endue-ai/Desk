// The formats endue.formats opens: which of its folders reads which format, and the Archive over what
// it opened, whose read and each take a job (its AbortSignal, and where to report how far a decode
// is). RAR takes one signal and one progress callback when it is opened, so its jobs run one at a
// time and those two follow the job that runs. No import of the library here: the worker loads its
// folders by URL, the frame through the import map, and both hand the module in.

/**
 * @typedef {import("./archive.js").Archive} Archive
 * @typedef {import("./archive.js").Entry} Entry
 * @typedef {import("../source.js").Source} Source
 * @typedef {import("./archive.js").Job} Job
 * @typedef {{ key: string, label: string }} Kind
 */

/** Library folders by format key. */
export const LIBRARY = /** @type {Record<string, string>} */ ({
  rar: "rar",
  dmg: "apple",
  img: "disk",
  vhd: "disk",
  vhdx: "disk",
  vmdk: "disk",
  qcow2: "disk",
  wim: "packs",
  squashfs: "packs",
  snap: "packs",
  appimage: "packs",
});

/** What crosses to the frame: everything but the functions. @param {Archive} archive */
export function described(archive) {
  const { format, entries, details, note, refusal } = archive;
  /** @type {Pick<Archive, "format" | "entries" | "details" | "note" | "refusal">} */
  const out = { format, entries, details };
  if (note) out.note = note;
  if (refusal) out.refusal = refusal;
  return out;
}

const cancelled = () => new DOMException("The work was cancelled.", "AbortError");

/**
 * Open `source` with the library module `lib` (the folder LIBRARY names for `kind`).
 * @param {any} lib @param {Kind} kind @param {Source} source @param {Job} [job]
 * @returns {Promise<Archive>}
 */
export async function openLibrary(lib, kind, source, job = {}) {
  if (kind.key === "rar") return openRar(lib, source, job);
  const options = { signal: job.signal };
  /** @type {Archive} */
  const archive =
    kind.key === "dmg"
      ? await lib.openDmg(source, options)
      : kind.key === "wim"
        ? await lib.openWim(source, options)
        : kind.key === "appimage"
          ? await lib.openAppImage(source, options)
          : kind.key === "squashfs" || kind.key === "snap"
            ? await lib.openSquashfs(source, { ...options, format: kind.label })
            : await lib.openDisk(source, options);
  return {
    ...described(archive),
    read: (entry, limit, job = {}) =>
      /** @type {any} */ (archive).read(entry, limit, { signal: job.signal }),
  };
}

/** @param {any} lib @param {Source} source @param {Job} first */
async function openRar(lib, source, first) {
  let job = first;
  const signal = {
    get aborted() {
      return !!job.signal?.aborted;
    },
    get reason() {
      return job.signal?.reason;
    },
  };
  /** @type {Required<Pick<Archive, "read" | "each">> & Archive} */
  const archive = await lib.openRar(source, {
    signal,
    progress: (/** @type {number} */ done, /** @type {number} */ total) =>
      job.report?.(done, total),
  });
  let queue = Promise.resolve();
  /** @template T @param {Job} next @param {() => Promise<T>} work @returns {Promise<T>} */
  const serial = (next, work) => {
    const run = queue.then(() => {
      if (next.signal?.aborted) throw cancelled();
      job = next;
      return work();
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    ...described(archive),
    read: (entry, limit, next = {}) => serial(next, () => archive.read(entry, limit)),
    each: (entries, visit, next = {}) => serial(next, () => archive.each(entries, visit)),
  };
}
