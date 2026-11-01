// Word 97-2003 (.doc, .dot), from [MS-DOC] and [MS-ODRAW]: the FIB, the piece table and FKPs, the
// stylesheet, fonts, lists and drawings; then the main document section by section with each
// section's page and its header and footer, footnotes and endnotes as their references are reached,
// comments with their authors and ranges, and the title from the summary information.
import { formatName } from "../formats.js";
import { DocError, documentOf, section, twips } from "../model.js";
import { formatNumber } from "../numbers.js";
import { readDrawings } from "./drawings.js";
import { PAIR, readFib } from "./fib.js";
import { readLists } from "./lists.js";
import {
  readBoxes,
  readComments,
  readNotes,
  readSections,
  storyRanges,
  storyStarts,
} from "./parts.js";
import { imageOf } from "./pictures.js";
import { applyChp, defaultChp } from "./props.js";
import { walk } from "./story.js";
import { readFonts, readStyles } from "./styles.js";
import { readText } from "./text.js";
import { titleOf } from "./title.js";

/**
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Inline} Inline
 * @typedef {import("./story.js").DocCtx} DocCtx
 */

/**
 * A part that fails to parse is left out, not the whole document.
 * @template T
 * @param {() => T} read
 * @param {T} fallback
 * @returns {T}
 */
const safely = (read, fallback) => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

/**
 * @param {import("../cfb.js").Cfb} cfb
 * @param {string} format
 */
export function readDoc(cfb, format) {
  const wd = cfb.read("WordDocument");
  if (!wd || wd.length < 0x200)
    throw new DocError("This file is damaged: its WordDocument stream is missing.");
  const fib = readFib(wd);
  const table = cfb.read(fib.tableName);
  if (!table) throw new DocError("This file is damaged: its table stream is missing.");
  const data = cfb.read("Data");
  const text = readText(wd, table, fib);
  const fonts = safely(() => readFonts(table, fib.pair(PAIR.sttbfFfn)), []);
  const styles = readStyles(table, fib, data);
  const ftcOf = (/** @type {Uint8Array} */ chpx) => {
    const chp = defaultChp({ ftcAsci: -1, ftcFE: -1, ftcOther: -1 });
    applyChp(chp, chpx, { style: chp, plain: chp, charStyle: () => chp });
    return chp.ftc0;
  };
  const lists = safely(() => readLists(table, fib, (ftc) => fonts[ftc] ?? "", ftcOf), {
    next: () => undefined,
  });
  const drawings = safely(() => readDrawings(wd, table, fib), {
    main: new Map(),
    header: new Map(),
    shape: () => undefined,
    blip: () => undefined,
  });
  const starts = storyStarts(fib.ccp);
  const footnotes = safely(() => readNotes(table, fib, "footnote", starts.ftn), new Map());
  const endnotes = safely(() => readNotes(table, fib, "endnote", starts.edn), new Map());
  const commentRefs = safely(() => readComments(table, fib, starts.atn), new Map());
  const noBoxes = { byIndex: [], byShape: new Map() };
  const boxes = {
    main: safely(() => readBoxes(table, fib.pair(PAIR.plcftxbxTxt), starts.txbx), noBoxes),
    header: safely(() => readBoxes(table, fib.pair(PAIR.plcfHdrtxbxTxt), starts.hdrTxbx), noBoxes),
  };
  const pages = safely(() => readSections(wd, table, fib), []);

  /** @type {Map<number, string>} */
  const ids = new Map();
  [...commentRefs.values()].forEach((c, i) => {
    ids.set(c.cp, String(i));
  });
  /** @type {import("../model.js").Note[]} */
  const notes = [];
  const counts = { footnote: 0, endnote: 0 };
  let nesting = 0;

  /** @type {DocCtx} */
  const doc = {
    text,
    styles,
    lists,
    fonts,
    data,
    ranges: [...commentRefs.values()].flatMap((c) =>
      c.range ? [{ id: ids.get(c.cp) ?? "", start: c.range[0], end: c.range[1] }] : [],
    ),
    sectionEnds: new Set(pages.map((p) => p.end - 1)),
    noteRef(cp, label) {
      const kind = footnotes.has(cp) ? "footnote" : "endnote";
      const ref = footnotes.get(cp) ?? endnotes.get(cp);
      if (!ref || nesting > 2) return undefined;
      if (ref.auto) counts[kind]++;
      const shown =
        label ??
        (kind === "footnote" ? String(counts[kind]) : formatNumber(counts[kind], "lowerRoman"));
      const id = `${kind[0]}${notes.length + 1}`;
      nesting++;
      notes.push({ id, kind, label: shown, blocks: walk(doc, ref.text[0], ref.text[1], "note") });
      nesting--;
      return { type: "noteref", note: id, label: shown };
    },
    customNote(cp) {
      const ref = footnotes.get(cp) ?? endnotes.get(cp);
      return ref !== undefined && !ref.auto;
    },
    commentPoint(cp) {
      const comment = commentRefs.get(cp);
      return comment && !comment.range ? ids.get(cp) : undefined;
    },
    shapes(cp, kind) {
      const header = kind === "header";
      const anchor = header
        ? drawings.header.get(cp - starts.hdd)
        : kind === "main"
          ? drawings.main.get(cp)
          : undefined;
      /** @type {{ images: Inline[], blocks: Block[] }} */
      const out = { images: [], blocks: [] };
      if (!anchor) return out;
      const stories = header ? boxes.header : boxes.main;
      const visit = (
        /** @type {number} */ spid,
        /** @type {number | undefined} */ width,
        /** @type {number | undefined} */ height,
        depth = 0,
      ) => {
        const shape = drawings.shape(spid);
        if (!shape || depth > 8) return;
        if (shape.pib && shape.children.length === 0) {
          const alt = shape.description || shape.name || "Picture";
          out.images.push(imageOf(drawings.blip(shape.pib), alt, width, height));
        }
        const txid = shape.txid ?? 0;
        const range =
          (txid && (txid & 0xffff) === 0 ? stories.byIndex[(txid >>> 16) - 1] : undefined) ??
          (txid ? undefined : stories.byShape.get(spid));
        if (range && range[1] > range[0] && nesting < 3) {
          nesting++;
          // A text box's range ends with a guard paragraph mark, as a header's does.
          out.blocks.push(...walk(doc, range[0], range[1] - 1, "box"));
          nesting--;
        }
        for (const child of shape.children) {
          const c = drawings.shape(child);
          const share = (
            /** @type {number | undefined} */ size,
            /** @type {number | undefined} */ part,
          ) => (size && part ? Math.round(size * part * 10) / 10 : undefined);
          visit(child, share(width, c?.shareX), share(height, c?.shareY), depth + 1);
        }
      };
      visit(anchor.spid, anchor.width || undefined, anchor.height || undefined);
      return out;
    },
  };

  // Headers: six separator stories, then six per section (even and odd header, even and odd
  // footer, first-page header and footer); an empty story keeps the previous section's.
  const hdd = safely(() => storyRanges(table, fib.pair(PAIR.plcfHdd), starts.hdd), []);
  const story = (/** @type {number} */ i, /** @type {number} */ slot) => {
    const range = hdd[6 + i * 6 + slot];
    return range && range[1] > range[0] ? range : undefined;
  };
  /** @type {import("../model.js").Section[]} */
  const sections = [];
  const close = (/** @type {Block[]} */ blocks) => {
    const i = sections.length;
    const page = pages[i] ?? pages.at(-1);
    const prev = sections.at(-1);
    const part = (/** @type {number} */ slot, /** @type {Block[] | undefined} */ kept) => {
      const range = story(i, slot);
      return range ? walk(doc, range[0], range[1] - 1, "header") : (kept ?? []);
    };
    sections.push(
      section({
        width: twips(page?.width ?? 12240),
        height: twips(page?.height ?? 15840),
        margins: {
          top: twips(page?.top ?? 1440),
          right: twips(page?.right ?? 1800),
          bottom: twips(page?.bottom ?? 1440),
          left: twips(page?.left ?? 1800),
          header: twips(page?.header ?? 720),
          footer: twips(page?.footer ?? 720),
        },
        header: part(1, prev?.header),
        footer: part(3, prev?.footer),
        blocks,
        continuous: i > 0 && page?.bkc === 0,
      }),
    );
  };
  const rest = walk(doc, 0, fib.ccp.text, "main", close);
  if (rest.length || sections.length === 0) close(rest);

  const comments = [...commentRefs.values()].map((c, i) => ({
    id: String(i),
    author: c.author,
    date: c.date,
    blocks: walk(doc, c.text[0], c.text[1], "comment"),
  }));
  return documentOf({
    format,
    formatName: formatName(format),
    title: safely(() => titleOf(cfb.read("\u0005SummaryInformation")), ""),
    sections,
    notes,
    comments,
  });
}
