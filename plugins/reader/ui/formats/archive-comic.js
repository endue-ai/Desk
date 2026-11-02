// CBR and CB7 comics through endue.formats: openRar and openSevenZip list the archive (in the library
// worker, or in the frame where none starts), and its images become pages in natural order, one
// page each, like CBZ (comics.js). A solid archive is decoded once, in its own order (solid.js);
// other archives decode the page asked for, keeping the last few. Encrypted and damaged archives
// become the details view with the library's sentence.
import { connect, startLibraryWorker, unavailable } from "../library-client.js";
import { isImage } from "./bytes.js";
import { hidden, readComic } from "./comics.js";
import { Unreadable } from "./errors.js";
import { createPass } from "./solid.js";

/**
 * @typedef {import("@endue-ai/formats/rar/index.js").Entry} Entry
 * @typedef {import("@endue-ai/formats/rar/index.js").Archive} Archive
 * @typedef {import("../library-client.js").Source} Source
 * @typedef {(done: number, total: number) => void} Report
 * @typedef {{ name?: string, signal?: AbortSignal, startWorker?: import("../library-client.js").StartWorker }} Options
 */

/** Pages decoded and kept for a page turn back, in an archive that is not solid. */
const KEEP = 4;

const aborted = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";
const sentence = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** The archive in the library worker, answering the Archive shape. @param {import("../library-client.js").Link} link @returns {Promise<Archive>} */
async function remote(
  link,
  /** @type {string} */ kind,
  /** @type {Source} */ source,
  /** @type {Options} */ { name, signal },
) {
  const opened = await link.ask({ type: "open", kind, size: source.size, name }, { signal });
  /** @type {Entry[]} */
  const entries = opened.entries;
  const at = new Map(entries.map((entry, i) => [entry, i]));
  return {
    format: opened.format,
    entries,
    details: opened.details,
    note: opened.note,
    refusal: opened.refusal,
    read: async (entry) => (await link.ask({ type: "entry", index: at.get(entry) })).bytes,
    each: async (wanted, visit) => {
      const indices = wanted.map((entry) => at.get(entry));
      const entry = (/** @type {any} */ data) =>
        visit(/** @type {Entry} */ (entries[data.index]), data.bytes);
      await link.ask({ type: "each", indices }, { entry });
    },
  };
}

/** @param {Source} source @param {"CBR" | "CB7"} kind @param {Options} options */
async function openArchive(source, kind, options) {
  const library = kind === "CBR" ? "rar" : "sevenzip";
  const worker = await startLibraryWorker(options.startWorker, options.signal);
  if (worker) {
    const link = connect(worker, source);
    try {
      return { archive: await remote(link, library, source, options), close: () => link.close() };
    } catch (error) {
      link.close();
      if (!unavailable(error)) throw error;
    }
  }
  const close = () => {};
  if (kind === "CBR") {
    const { openRar } = await import("@endue-ai/formats/rar/index.js");
    return { archive: await openRar(source, { signal: options.signal }), close };
  }
  const { openSevenZip } = await import("@endue-ai/formats/sevenzip/index.js");
  return { archive: await openSevenZip(source, options.name ?? ""), close };
}

/**
 * @param {Source} source
 * @param {"CBR" | "CB7"} kind
 * @param {Options} [options]
 */
export async function readArchiveComic(source, kind, options = {}) {
  const format = `${kind} comic`;
  /** @type {Awaited<ReturnType<typeof openArchive>>} */
  let opened;
  try {
    opened = await openArchive(source, kind, options);
  } catch (error) {
    if (options.signal?.aborted || aborted(error)) throw error;
    throw new Unreadable(sentence(error), { format });
  }
  try {
    return await pagesOf(opened.archive, kind, opened.close);
  } catch (error) {
    opened.close();
    throw error;
  }
}

/** @param {Archive} archive @param {"CBR" | "CB7"} kind @param {() => void} close */
async function pagesOf(archive, kind, close) {
  const format = `${kind} comic`;
  const facts = [{ label: "Archive", value: archive.format }];
  // RAR's encrypted headers: not even the names can be listed.
  if (archive.note) throw new Unreadable(archive.note, { format, facts });
  const images = archive.entries.filter(
    (e) => e.kind === "file" && isImage(e.path) && !hidden(e.path),
  );
  const refused = images.find((e) => e.refusal);
  if (refused && images.every((e) => e.refusal)) {
    const why = refused.encrypted
      ? "The comic's pages are encrypted, and the reader opens no password-protected archives."
      : "None of the comic's pages can be decoded.";
    throw new Unreadable(why, {
      format,
      facts: [
        ...facts,
        { label: "Pages", value: String(images.length) },
        { label: "Problem", value: refused.refusal ?? "" },
      ],
    });
  }
  const byPath = new Map(images.map((e) => [e.path, e]));
  const solid = archive.details.some((d) => d.label === "Solid" && d.value === "Yes");
  const each = archive.each;
  const pass =
    solid && each
      ? createPass(
          (entries, visit) => each(entries, visit),
          images.filter((e) => !e.refusal),
          (e) => e.size,
        )
      : undefined;
  /** @type {Map<Entry, Promise<Uint8Array>>} */
  const recent = new Map();
  /** @param {string} path @param {AbortSignal} [signal] @param {Report} [report] */
  const read = async (path, signal, report) => {
    const entry = byPath.get(path);
    if (!entry) throw new Unreadable(`The archive holds no ${path}.`, { format });
    if (entry.refusal) throw new Unreadable(entry.refusal, { format });
    if (pass) return pass.want(entry, signal, report);
    let bytes = recent.get(entry);
    if (!bytes) {
      bytes = archive.read(entry);
      bytes.catch(() => recent.delete(entry));
    }
    recent.delete(entry);
    recent.set(entry, bytes);
    while (recent.size > KEEP) recent.delete(/** @type {Entry} */ (recent.keys().next().value));
    return bytes;
  };
  const book = await readComic({ names: images.map((e) => e.path), read }, kind);
  return {
    ...book,
    close: () => {
      pass?.close();
      close();
    },
  };
}
