// PowerPoint 97-2003 (.ppt, .pps, .pot) as a text-only deck: each slide's title and body text from
// the PowerPoint Document stream, laid out as a title over the body, its pictures from the Pictures
// stream at their anchors, its notes and its hidden mark.
import { imageUrl, u16, u32 } from "../bytes.js";
import { boxOf, imageCache, NO_FILL, paragraphOf, rect, runOf, textOf } from "../deck.js";
import {
  anchorOf,
  blipBytes,
  childOf,
  childrenOf,
  descendants,
  paragraphStyles,
  persistDirectory,
  propertiesOf,
  recordAt,
  T,
  textOfAtom,
} from "./records.js";

/**
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../deck.js").Slide} Slide
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {{ type: number, text: string, styles: Array<{ level: number, bullet: boolean }> }} PptText
 * @typedef {{ texts: PptText[], pictures: Array<{ blip: number, anchor: number[] }> }} Drawn
 */

export class EncryptedError extends Error {}

const TITLE_TYPES = [0, 6];
const NOTES_TYPE = 2;

/** The texts and pictures in a slide's or notes page's drawing. */
function drawingOf(
  /** @type {Uint8Array} */ doc,
  /** @type {PptRecord} */ container,
  /** @type {PptText[]} */ outline,
) {
  /** @type {Drawn} */
  const out = { texts: [], pictures: [] };
  const drawing = childOf(doc, container, T.drawing);
  if (!drawing) return out;
  /** Walk a group: its first shape gives its frame, which maps its children's anchors. */
  const group = (/** @type {PptRecord} */ spgr, /** @type {(a: number[]) => number[]} */ map) => {
    let frame = map;
    for (const [i, child] of childrenOf(doc, spgr).entries()) {
      if (child.type === T.spgr) {
        group(child, frame);
        continue;
      }
      if (child.type !== T.sp) continue;
      const anchorRec = childOf(doc, child, T.clientAnchor) ?? childOf(doc, child, T.childAnchor);
      const anchor = anchorOf(doc, anchorRec);
      const groupFrame = anchorOf(doc, childOf(doc, child, T.spgrAtom));
      if (i === 0 && groupFrame && anchor) {
        const [l = 0, t = 0, r = 0, b = 0] = map(anchor);
        const [gl = 0, gt = 0, gr = 1, gb = 1] = groupFrame;
        const sx = (r - l) / (gr - gl || 1);
        const sy = (b - t) / (gb - gt || 1);
        frame = (a) => [
          l + ((a[0] ?? 0) - gl) * sx,
          t + ((a[1] ?? 0) - gt) * sy,
          l + ((a[2] ?? 0) - gl) * sx,
          t + ((a[3] ?? 0) - gt) * sy,
        ];
        continue;
      }
      shape(child, anchor ? frame(anchor) : null);
    }
  };
  const shape = (/** @type {PptRecord} */ sp, /** @type {number[] | null} */ anchor) => {
    const props = propertiesOf(doc, childOf(doc, sp, T.fopt));
    const blip = props.get(0x0104) ?? props.get(0x0186);
    if (blip && anchor) out.pictures.push({ blip, anchor });
    const box = childOf(doc, sp, T.clientTextbox);
    if (!box) return;
    let type = 4;
    for (const rec of childrenOf(doc, box)) {
      if (rec.type === T.textHeader) type = u32(doc, rec.body);
      else if (rec.type === T.outlineRef) {
        const ref = outline[u32(doc, rec.body)];
        if (ref) out.texts.push(ref);
      } else {
        const text = textOfAtom(doc, rec);
        if (text === null) continue;
        const style =
          childrenOf(doc, box).find((r) => r.type === T.styleText && r.at > rec.at) ?? null;
        out.texts.push({ type, text, styles: paragraphStyles(doc, style, text) });
      }
    }
  };
  for (const rec of descendants(doc, drawing))
    if (rec.type === T.spgr) {
      group(rec, (a) => a);
      break;
    }
  return out;
}

/** The text atoms of one slide's entry in a SlideListWithText, by index. */
function outlineTexts(/** @type {Uint8Array} */ doc, /** @type {PptRecord[]} */ records) {
  /** @type {PptText[]} */
  const texts = [];
  let type = 4;
  for (const [i, rec] of records.entries()) {
    if (rec.type === T.textHeader) type = u32(doc, rec.body);
    const text = textOfAtom(doc, rec);
    if (text === null) continue;
    const style = records
      .slice(i + 1)
      .find((r) => r.type === T.styleText || r.type === T.textHeader);
    texts.push({
      type,
      text,
      styles: paragraphStyles(doc, style?.type === T.styleText ? style : null, text),
    });
  }
  return texts;
}

/** Paragraphs of texts: "\r" ends one, "\v" breaks a line, a lone "*" is a field. @param {PptText[]} texts */
function paragraphs(texts, /** @type {number} */ size, /** @type {boolean} */ bold) {
  return texts.flatMap((t) =>
    t.text
      .replace(/\r$/, "")
      .split("\r")
      .map((line, i) => ({
        line: line.replace(/\v/g, "\n"),
        style: t.styles[i] ?? { level: 0, bullet: false },
      }))
      .filter(({ line }) => line.trim() !== "" && line.trim() !== "*")
      .map(({ line, style }) =>
        paragraphOf([runOf(line, { size: size * (1 - style.level * 0.1), bold, font: "" })], {
          level: style.level,
          marginLeft: style.level * size * 1.2 + (style.bullet ? size : 0),
          indent: style.bullet ? -size : 0,
          bullet: style.bullet ? { text: "•", color: "#000000", font: "", size } : null,
        }),
      ),
  );
}

/** @param {{ stream(name: string): Uint8Array | null }} cfb @param {string} format @returns {Deck} */
export function readPpt(cfb, format) {
  const user = cfb.stream("Current User");
  const doc = cfb.stream("PowerPoint Document");
  if (!doc) throw new Error("no PowerPoint Document stream");
  if (user && u32(user, 12) === 0xf3d1c4df) throw new EncryptedError("encrypted");
  const { offsets, docPersist, encrypted } = persistDirectory(doc, user ? u32(user, 16) : 0);
  if (encrypted) throw new EncryptedError("encrypted");
  const docRec = recordAt(doc, offsets.get(docPersist) ?? 0);
  if (!docRec || docRec.type !== T.document) throw new Error("no document container");
  const atom = childOf(doc, docRec, T.documentAtom);
  const width = (atom ? u32(doc, atom.body) : 5760) / 8 || 720;
  const height = (atom ? u32(doc, atom.body + 4) : 4320) / 8 || 540;

  /** Slide lists: 0 slides, 2 notes. Each entry: the persist atom and the text records after it. */
  const lists = childrenOf(doc, docRec).filter((r) => r.type === T.slideList);
  const entries = (/** @type {number} */ inst) => {
    /** @type {Array<{ persist: number, slideId: number, records: PptRecord[] }>} */
    const out = [];
    for (const rec of childrenOf(doc, lists.find((l) => l.inst === inst) ?? null)) {
      if (rec.type === T.slidePersist)
        out.push({ persist: u32(doc, rec.body), slideId: u32(doc, rec.body + 12), records: [] });
      else out.at(-1)?.records.push(rec);
    }
    return out;
  };
  /** Notes text by the notes page's own id, and by the id of the slide it belongs to. */
  /** @type {Map<number, string>} */
  const notesById = new Map();
  /** @type {Map<number, string>} */
  const notesBySlide = new Map();
  for (const entry of entries(2)) {
    const container = recordAt(doc, offsets.get(entry.persist) ?? -1);
    if (!container || container.type !== T.notes) continue;
    const slideRef = u32(doc, childOf(doc, container, T.notesAtom)?.body ?? 0);
    const drawn = drawingOf(doc, container, outlineTexts(doc, entry.records));
    const text = drawn.texts
      .filter((t) => t.type === NOTES_TYPE)
      .map((t) => t.text.replace(/\r$/, "").replace(/[\r\v]/g, "\n"))
      .join("\n");
    notesById.set(entry.slideId, text.trim());
    notesBySlide.set(slideRef, text.trim());
  }

  const pictures = cfb.stream("Pictures");
  const store = descendants(doc, childOf(doc, docRec, T.drawingGroup) ?? docRec).find(
    (r) => r.type === T.bstore,
  );
  const blips = store ? childrenOf(doc, store) : [];
  const image = imageCache(async (id) => {
    const rec = blips[Number(id.slice(4)) - 1];
    if (!rec) return null;
    if (rec.type !== T.fbse) return imageUrl(blipBytes(doc, rec.at) ?? new Uint8Array());
    const nameLength = doc[rec.body + 33] ?? 0;
    const embedded = rec.len > 36 + nameLength;
    const bytes = embedded
      ? blipBytes(doc, rec.body + 36 + nameLength)
      : pictures
        ? blipBytes(pictures, u32(doc, rec.body + 28))
        : null;
    return bytes ? imageUrl(bytes) : null;
  });

  const pt = (/** @type {number} */ units) => units / 8;
  /** @type {Slide[]} */
  const slides = entries(0).map((entry, i) => {
    const container = recordAt(doc, offsets.get(entry.persist) ?? -1);
    const isSlide = container?.type === T.slide;
    const drawn =
      isSlide && container
        ? drawingOf(doc, container, outlineTexts(doc, entry.records))
        : { texts: outlineTexts(doc, entry.records), pictures: [] };
    if (drawn.texts.length === 0) drawn.texts = outlineTexts(doc, entry.records);
    const titleTexts = drawn.texts.filter((t) => TITLE_TYPES.includes(t.type));
    const bodyTexts = drawn.texts.filter(
      (t) => !TITLE_TYPES.includes(t.type) && t.type !== NOTES_TYPE,
    );
    const titleSize = Math.round(height * 0.067);
    const titleParagraphs = paragraphs(titleTexts.slice(0, 1), titleSize, true);
    const bodyBox = boxOf({ x: width * 0.06, y: height * 0.24, w: width * 0.88, h: height * 0.7 });
    let bodySize = Math.round(height * 0.044);
    const lines = paragraphs(bodyTexts, bodySize, false).length;
    if (lines * bodySize * 1.45 > bodyBox.h) bodySize = Math.max(8, bodyBox.h / (lines * 1.45));
    /** @type {SlideElement[]} */
    const elements = [
      shapeOf(
        "Title",
        "title",
        boxOf({ x: width * 0.06, y: height * 0.05, w: width * 0.88, h: height * 0.16 }),
        titleParagraphs,
        "bottom",
      ),
      shapeOf("Body", "body", bodyBox, paragraphs(bodyTexts, bodySize, false), "top"),
    ];
    for (const [n, p] of drawn.pictures.entries()) {
      const [l = 0, t = 0, r = 0, b = 0] = p.anchor;
      elements.push({
        type: "picture",
        name: `Picture ${n + 1}`,
        box: boxOf({ x: pt(l), y: pt(t), w: pt(r - l), h: pt(b - t) }),
        image: `pib:${p.blip}`,
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        line: null,
        geometry: rect(),
        label: `Picture ${n + 1}`,
      });
    }
    const info = container ? childOf(doc, container, T.slideShowInfo) : null;
    const slideAtom = container ? childOf(doc, container, T.slideAtom) : null;
    return {
      number: i + 1,
      title: titleParagraphs
        .map((p) => p.runs.map((r) => r.text).join(""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      hidden: info ? Boolean(u16(doc, info.body + 10) & 0x4) : false,
      background: { type: "solid", color: "#ffffff" },
      elements,
      notes:
        notesById.get(slideAtom ? u32(doc, slideAtom.body + 16) : -1) ??
        notesBySlide.get(entry.slideId) ??
        "",
    };
  });
  return { format, size: { width, height }, slides, textOnly: true, image };
}

/** A text shape of the text-only layout. */
function shapeOf(
  /** @type {string} */ name,
  /** @type {string} */ placeholder,
  /** @type {import("../deck.js").Box} */ box,
  /** @type {import("../deck.js").Paragraph[]} */ paras,
  /** @type {"top" | "bottom"} */ anchor,
) {
  return /** @type {SlideElement} */ ({
    type: "shape",
    name,
    box,
    geometry: rect(),
    fill: NO_FILL,
    line: null,
    text: textOf(paras, { anchor }),
    placeholder,
  });
}
