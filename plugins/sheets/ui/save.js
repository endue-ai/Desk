// What Sheets saves, and how (ADR 0071). Each open file has an edit tier: CSV and TSV read as UTF-8
// are lossless, everything else is read-only and says why. A lossless file holds a document of its
// edits over the grid's sheet; a save writes the whole file with fs.write under the plugin's grants,
// asking once for the file's folder when they do not cover it, as reading does.
import { createCsvDoc, editableSheet } from "./csv-edit.js";
import { extensionOf } from "./detect.js";

/**
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./book.js").Book} Book
 * @typedef {import("./csv-edit.js").CsvDoc} CsvDoc
 * @typedef {{ tier: "lossless" | "read-only", format: string, detail?: string, refusal?: string }} Tier
 *   format: the label's prefix ("CSV"); detail: why, when the words of the tier do not say it;
 *   refusal: what desk.files.save answers for a read-only file
 * @typedef {{
 *   book: Book, tier: Tier, doc: CsvDoc | undefined, reported: boolean,
 *   editable: ((r: number, c: number) => boolean) | undefined,
 * }} Editing
 * @typedef {{ call(method: string, params: Record<string, unknown>): Promise<any> }} Bridge
 */

const TEXT = new Set(["csv", "tsv"]);

/**
 * The edit tier of a file as it opened.
 * @param {string} name
 * @param {Book} book
 * @returns {Tier}
 */
export function tierOf(name, book) {
  const format = extensionOf(name).toUpperCase();
  if (book.kind === "sheets" && book.csv) return { tier: "lossless", format };
  if (book.kind === "sheets" && TEXT.has(extensionOf(name))) {
    const encoding = book.encoding ?? "not UTF-8";
    return {
      tier: "read-only",
      format,
      detail: `Sheets saves CSV and TSV files in UTF-8 only; this one is ${encoding}, so it opens for reading.`,
      refusal: `Sheets saves CSV and TSV files in UTF-8 only; ${name} is ${encoding}.`,
    };
  }
  const refusal = format
    ? `Sheets opens ${format} files read-only.`
    : `Sheets opens ${name} read-only.`;
  return { tier: "read-only", format, refusal };
}

/**
 * A file as Sheets holds it once open: its tier and, when lossless, the document of its edits and
 * the sheet that shows them. Every key is set, so assigning it over a reverted file replaces all.
 * @param {{ name: string, book: Book }} file
 * @returns {Editing}
 */
export function editing({ name, book }) {
  const tier = tierOf(name, book);
  if (book.kind !== "sheets" || !book.csv) {
    return { book, tier, doc: undefined, reported: false, editable: undefined };
  }
  const doc = createCsvDoc(book.csv);
  // The document keeps the model; the book does not need it twice.
  const sheets = book.sheets.map((sheet) => editableSheet(sheet, doc));
  const shown = { ...book, csv: undefined, sheets };
  return { book: shown, tier, doc, reported: false, editable: doc.editable };
}

/** Bytes to base64, a slice at a time, as fs.write takes binary content. */
export function base64Of(/** @type {Uint8Array} */ bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * Write a whole file. When the grants do not cover it, ask once for its folder and try again; every
 * failure is an Error whose message is the sentence the person reads.
 * @param {Bridge} bridge
 * @param {string} path
 * @param {Uint8Array} bytes
 */
export async function writeFile(bridge, path, bytes) {
  const slash = path.lastIndexOf("/");
  const folder = slash < 0 ? path : path.slice(0, slash);
  const scope = { permission: "fs:write", paths: [`${folder}/**`] };
  const content = base64Of(bytes);
  const call = () => bridge.call("fs.write", { path, content, encoding: "base64", scope });
  const refused = new Error(`Not allowed to write ${path}.`);
  const failed = (/** @type {unknown} */ error) =>
    codeOf(error) === "permission_denied"
      ? refused
      : new Error(`Could not write ${path}: ${codeOf(error)}.`);
  try {
    return await call();
  } catch (error) {
    if (codeOf(error) !== "permission_denied") throw failed(error);
  }
  // perm.request answers a refusal as a result; a failed ask counts as one.
  const reason = `To save ${path} in Sheets`;
  const decision = await bridge
    .call("perm.request", { permission: /** @type {Permission} */ (scope), reason })
    .catch(() => ({ granted: false }));
  if (!decision.granted) throw refused;
  return call().catch((error) => {
    throw failed(error);
  });
}
