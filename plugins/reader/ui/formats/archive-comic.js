// CBR and CB7 comics through endue.formats: openRar and openSevenZip list the archive, and its
// images become pages in natural order, one page each, like CBZ (comics.js). A solid archive is
// decoded once, in its own order (solid.js); other archives decode the page asked for, keeping the
// last few. Encrypted and damaged archives become the details view with the library's sentence.
import { openRar } from "@endue-ai/formats/rar/index.js";
import { openSevenZip } from "@endue-ai/formats/sevenzip/index.js";
import { isImage } from "./bytes.js";
import { hidden, readComic } from "./comics.js";
import { Unreadable } from "./errors.js";
import { createPass } from "./solid.js";

/**
 * @typedef {import("@endue-ai/formats/rar/index.js").Entry} Entry
 * @typedef {{ size: number, read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> }} Source
 * @typedef {(done: number, total: number) => void} Report
 */

/** Pages decoded and kept for a page turn back, in an archive that is not solid. */
const KEEP = 4;

const aborted = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";
const sentence = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {Source} source
 * @param {"CBR" | "CB7"} kind
 * @param {{ name?: string, signal?: AbortSignal }} [options]
 */
export async function readArchiveComic(source, kind, { name = "", signal } = {}) {
  const format = `${kind} comic`;
  /** @type {Awaited<ReturnType<typeof openRar>>} */
  let archive;
  try {
    archive = kind === "CBR" ? await openRar(source, { signal }) : await openSevenZip(source, name);
  } catch (error) {
    if (signal?.aborted || aborted(error)) throw error;
    throw new Unreadable(sentence(error), { format });
  }
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
  return { ...book, close: () => pass?.close() };
}
