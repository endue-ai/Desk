// Word (OOXML: .docx, .docm, .dotx, .dotm): the package's relationships, then styles, numbering,
// theme fonts, comments, footnotes and endnotes, the body and its sections with their headers and
// footers. Every part and picture is loaded first, so the walk over the XML is synchronous.
import { pictureUrl } from "../bytes.js";
import { formatName } from "../formats.js";
import { DocError, documentOf, LETTER, section, twips } from "../model.js";
import { formatNumber } from "../numbers.js";
import { attr, find, kid, kids, num, parseXml } from "../xml.js";
import { resolvePath } from "../zip.js";
import { blocks } from "./body.js";
import { createNumbering } from "./numbering.js";
import { createStyles, themeFonts } from "./styles.js";

/**
 * @typedef {{ path: string, doc: Document, rels: Map<string, { type: string, target: string, external: boolean }>, media: Map<string, string | null> }} Part
 * @typedef {import("../model.js").Block} Block
 */

/**
 * @param {import("../zip.js").Zip} zip
 * @param {string} format
 */
export async function readOoxml(zip, format) {
  const rootRels = await relsOf(zip, "");
  const main = [...rootRels.values()].find((r) => r.type.endsWith("/officeDocument"))?.target;
  const mainPath = main ? resolvePath("", main) : "word/document.xml";
  const document = await loadPart(zip, mainPath);
  if (!document) throw new DocError("This file is damaged: it has no document part.");
  const related = async (/** @type {string} */ kind) => {
    const rel = [...document.rels.values()].find((r) => r.type.endsWith(`/${kind}`));
    return rel ? loadPart(zip, rel.target) : undefined;
  };
  const theme = themeFonts((await related("theme"))?.doc);
  const styles = createStyles((await related("styles"))?.doc, theme);
  const numbering = createNumbering((await related("numbering"))?.doc, styles);
  const commentsPart = await related("comments");
  const footnotesPart = await related("footnotes");
  const endnotesPart = await related("endnotes");
  /** @type {Map<string, Part>} */
  const parts = new Map();
  for (const rel of document.rels.values()) {
    if (!/\/(header|footer)$/.test(rel.type)) continue;
    const part = await loadPart(zip, rel.target);
    if (part) parts.set(rel.target, part);
  }

  /** @type {import("../model.js").Note[]} */
  const notes = [];
  const counts = { footnote: 0, endnote: 0 };
  const commentEls = kids(commentsPart?.doc.documentElement, "comment");
  const known = new Set(commentEls.map((c) => attr(c, "id") ?? ""));

  /** A walking context for one part; notes and comments are parsed in their own. */
  const ctxFor = (/** @type {Part} */ part) => ({
    styles,
    numbering,
    rels: part.rels,
    media: part.media,
    fields: [],
    comments: new Set(),
    ranged: new Set(),
    known,
    pending: [],
    boxes: (/** @type {Element} */ content) => blocks(content, ctxFor(part)),
    noteRef,
  });

  /**
   * @param {"footnote" | "endnote"} kind
   * @param {string} id
   * @returns {import("../model.js").Inline | undefined}
   */
  function noteRef(kind, id) {
    const part = kind === "footnote" ? footnotesPart : endnotesPart;
    const el = kids(part?.doc.documentElement, kind).find((n) => attr(n, "id") === id);
    if (!part || !el) return undefined;
    counts[kind]++;
    const label =
      kind === "footnote" ? String(counts[kind]) : formatNumber(counts[kind], "lowerRoman");
    const noteId = `${kind[0]}${id}`;
    notes.push({ id: noteId, kind, label, blocks: blocks(el, ctxFor(part)) });
    return { type: "noteref", note: noteId, label };
  }

  const comments = commentsPart
    ? commentEls.map((el) => ({
        id: attr(el, "id") ?? "",
        author: attr(el, "author") ?? "",
        date: attr(el, "date") ?? "",
        blocks: blocks(el, ctxFor(commentsPart)),
      }))
    : [];

  /** @type {Map<string, Block[]>} */
  const headers = new Map();
  const partBlocks = (/** @type {string} */ id) => {
    const target = document.rels.get(id)?.target ?? "";
    const done = headers.get(target);
    if (done) return done;
    const part = parts.get(target);
    const out = part ? blocks(part.doc.documentElement, ctxFor(part)) : [];
    headers.set(target, out);
    return out;
  };

  /** @type {import("../model.js").Section[]} */
  const sections = [];
  const close = (/** @type {Element | null} */ sectPr, /** @type {Block[]} */ body) => {
    const prev = sections.at(-1);
    const size = kid(sectPr, "pgSz");
    const mar = kid(sectPr, "pgMar");
    const margin = (/** @type {string} */ side, /** @type {number} */ fallback) =>
      Math.abs(twips(num(mar, side) ?? fallback));
    const ref = (/** @type {string} */ which) =>
      kids(sectPr, `${which}Reference`).find((r) => (attr(r, "type") ?? "default") === "default");
    const header = ref("header");
    const footer = ref("footer");
    sections.push(
      section({
        width: twips(num(size, "w") ?? LETTER.width * 20),
        height: twips(num(size, "h") ?? LETTER.height * 20),
        margins: {
          top: margin("top", 1440),
          right: margin("right", 1440),
          bottom: margin("bottom", 1440),
          left: margin("left", 1440),
          header: margin("header", 720),
          footer: margin("footer", 720),
        },
        header: header ? partBlocks(attr(header, "id") ?? "") : (prev?.header ?? []),
        footer: footer ? partBlocks(attr(footer, "id") ?? "") : (prev?.footer ?? []),
        blocks: body,
        continuous: attr(kid(sectPr, "type"), "val") === "continuous",
      }),
    );
  };
  const body = find(document.doc, "body");
  if (!body) throw new DocError("This file is damaged: its document has no body.");
  const rest = blocks(body, ctxFor(document), (sectPr, done) => close(sectPr, done));
  close(kid(body, "sectPr"), rest);
  if (sections[0]) sections[0].continuous = false;

  const title = await titleOf(zip);
  return documentOf({ format, formatName: formatName(format), title, sections, notes, comments });
}

/**
 * The relationships of a part ("" for the package's own).
 * @param {import("../zip.js").Zip} zip
 * @param {string} path
 */
async function relsOf(zip, path) {
  const slash = path.lastIndexOf("/");
  const relsPath = `${path.slice(0, slash + 1)}_rels/${path.slice(slash + 1)}.rels`;
  /** @type {Map<string, { type: string, target: string, external: boolean }>} */
  const rels = new Map();
  const text = await zip.text(relsPath);
  if (!text) return rels;
  for (const rel of kids(parseXml(text, relsPath).documentElement, "Relationship")) {
    const external = attr(rel, "TargetMode") === "External";
    const target = attr(rel, "Target") ?? "";
    rels.set(attr(rel, "Id") ?? "", {
      type: attr(rel, "Type") ?? "",
      target: external ? target : resolvePath(path, target),
      external,
    });
  }
  return rels;
}

/**
 * A part, its relationships and its pictures as data: URLs.
 * @param {import("../zip.js").Zip} zip
 * @param {string} path
 * @returns {Promise<Part | undefined>}
 */
async function loadPart(zip, path) {
  const text = await zip.text(path);
  if (text === undefined) return undefined;
  const doc = parseXml(text, path);
  const rels = await relsOf(zip, path);
  /** @type {Map<string, string | null>} */
  const media = new Map();
  for (const [id, rel] of rels) {
    if (!rel.type.endsWith("/image") || rel.external) continue;
    const bytes = await zip.read(rel.target).catch(() => undefined);
    media.set(id, bytes ? pictureUrl(bytes) : null);
  }
  return { path, doc, rels, media };
}

/** The title in docProps/core.xml, or "" when there is none or it does not parse. */
async function titleOf(/** @type {import("../zip.js").Zip} */ zip) {
  try {
    const core = await zip.text("docProps/core.xml");
    return core ? (find(parseXml(core, "core.xml"), "title")?.textContent ?? "").trim() : "";
  } catch {
    return "";
  }
}
