// PowerPoint 97-2003 (.ppt, .pps, .pot) as a deck ([MS-PPT]): the latest user edit and its persist
// directory, the document's size, fonts and default styles, the masters (main and title) with their
// colour schemes, text styles, shapes and backgrounds, then every slide in order: the master's shapes
// and footers it shows, its own shapes, its background, notes and hidden mark. Pictures come from
// the Pictures stream when the renderer asks for them. No DOM.
import { imageUrl } from "../bytes.js";
import { imageCache, plainText } from "../deck.js";
import { DEFAULT_SCHEME, schemeOf } from "./color.js";
import { fallbackSlide } from "./fallback.js";
import {
  blipBytes,
  childOf,
  childrenOf,
  descendants,
  persistDirectory,
  recordAt,
  T,
  u16,
  u32,
} from "./records.js";
import { backgroundIn, masterPlacement, readDrawing, shapeTable } from "./shapes.js";
import { masterLevels, readCF, readPF } from "./styles.js";
import { outlinesOf, readText } from "./textbox.js";

/**
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../deck.js").Slide} Slide
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {import("./styles.js").Level} Level
 * @typedef {import("./shapes.js").MasterShape} MasterShape
 * @typedef {import("./shapes.js").Scope} Scope
 * @typedef {{
 *   id: number, rec: PptRecord, main: boolean, parent: number, flags: number, scheme: string[],
 *   styles: Map<number, Level[]>, drawing: PptRecord | null, placeholders: Map<number, MasterShape>
 * }} Master
 * @typedef {{ flags: number, date: string, header: string, footer: string }} HeadersFooters
 */

export class EncryptedError extends Error {}

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
  const firstNumber = atom ? u16(doc, atom.body + 32) || 1 : 1;
  const omitOnTitle = atom ? doc[atom.body + 37] === 1 : false;
  const at = (/** @type {number} */ persist) => recordAt(doc, offsets.get(persist) ?? -1);

  // Fonts and the document's default text styles.
  const env = childOf(doc, docRec, T.environment);
  const fonts = childrenOf(doc, childOf(doc, env, T.fontCollection))
    .filter((r) => r.type === T.fontEntity)
    .map((r) => faceName(doc, r));
  const cfDefaults = childOf(doc, env, T.textCFDefaults);
  const pfDefaults = childOf(doc, env, T.textPFDefaults);
  /** @type {Level[]} */
  const defaults = [
    {
      pf: pfDefaults ? readPF(doc, pfDefaults.body + 2).pf : {},
      cf: cfDefaults ? readCF(doc, cfDefaults.body).cf : {},
    },
  ];
  const envStyles = stylesIn(doc, env);

  /** Slide lists: 0 slides, 1 masters, 2 notes. Each entry: the persist atom and the records after it. */
  const lists = childrenOf(doc, docRec).filter((r) => r.type === T.slideList);
  const entries = (/** @type {number} */ inst) => {
    /** @type {Array<{ persist: number, id: number, records: PptRecord[] }>} */
    const out = [];
    for (const rec of childrenOf(doc, lists.find((l) => l.inst === inst) ?? null)) {
      if (rec.type === T.slidePersist)
        out.push({ persist: u32(doc, rec.body), id: u32(doc, rec.body + 12), records: [] });
      else out.at(-1)?.records.push(rec);
    }
    return out;
  };

  /** @type {Map<number, MasterShape>} */
  const masterShapes = new Map();
  /** @type {Map<number, Master>} */
  const masters = new Map();
  for (const entry of entries(1)) {
    const rec = at(entry.persist);
    if (!rec || (rec.type !== T.mainMaster && rec.type !== T.slide)) continue;
    const slideAtom = childOf(doc, rec, T.slideAtom);
    const drawing = childOf(doc, rec, T.drawing);
    /** @type {Map<number, MasterShape>} */
    const own = shapeTable(doc, drawing, new Map());
    for (const [k, v] of own) masterShapes.set(k, v);
    masters.set(entry.id, {
      id: entry.id,
      rec,
      main: rec.type === T.mainMaster,
      parent: slideAtom ? u32(doc, slideAtom.body + 12) : 0,
      flags: slideAtom ? u16(doc, slideAtom.body + 20) : 0,
      scheme: schemeIn(doc, rec) ?? [],
      styles: stylesIn(doc, rec),
      drawing,
      placeholders: new Map(
        [...own.values()].filter((s) => s.placement).map((s) => [s.placement, s]),
      ),
    });
  }
  const firstMain = [...masters.values()].find((m) => m.main);
  const mainOf = (/** @type {Master | undefined} */ m) =>
    m && !m.main ? (masters.get(m.parent) ?? firstMain) : (m ?? firstMain);
  // A title master without a scheme of its own, or following its main master's, takes that one.
  for (const m of masters.values())
    if (!m.main && (m.flags & 2 || m.scheme.length === 0)) m.scheme = mainOf(m)?.scheme ?? [];
  for (const m of masters.values()) if (m.scheme.length === 0) m.scheme = DEFAULT_SCHEME;

  const notes = notesOf(doc, entries(2), at);
  const image = imagesOf(doc, docRec, cfb.stream("Pictures"));
  const docHF = headersFootersIn(doc, docRec, 3);

  /** @type {Slide[]} */
  const slides = entries(0).map((entry, i) => {
    const number = firstNumber + i;
    const container = at(entry.persist);
    const outline = outlinesOf(doc, entry.records);
    if (container?.type !== T.slide) return fallbackSlide(doc, outline, i + 1, width, height);
    const slideAtom = childOf(doc, container, T.slideAtom);
    const flags = slideAtom ? u16(doc, slideAtom.body + 20) : 7;
    const master = masters.get(slideAtom ? u32(doc, slideAtom.body + 12) : 0) ?? firstMain;
    const main = mainOf(master);
    const scheme =
      (flags & 2 ? null : schemeIn(doc, container)) ?? master?.scheme ?? DEFAULT_SCHEME;
    const hf = headersFootersIn(doc, container, 0) ?? docHF;
    const drawing = childOf(doc, container, T.drawing);
    const ownPlacements = new Set(
      [...shapeTable(doc, drawing, new Map()).values()].map((s) => s.placement),
    );
    const isTitle = slideAtom ? u32(doc, slideAtom.body) === 0 : false;
    const shows = (/** @type {number} */ p) =>
      !ownPlacements.has(p) &&
      !(omitOnTitle && isTitle) &&
      Boolean((hf?.flags ?? 0) & (p === 7 ? 1 : p === 8 ? 8 : p === 9 ? 0x20 : 0));
    const backgroundOf = (/** @type {Master | undefined} */ m, depth = 0) => {
      const found =
        m && (m.main || !(m.flags & 4))
          ? backgroundIn(
              m.drawing,
              scopeFor(m, () => false, [], { type: "none" }),
            )
          : null;
      if (!found && m && !m.main && depth < 2) return backgroundOf(mainOf(m), depth + 1);
      return found ?? { type: "solid", color: scheme[0] ?? "#ffffff" };
    };
    /** A scope for a drawing on this slide. */
    function scopeFor(
      /** @type {Master | undefined} */ owner,
      /** @type {(p: number) => boolean} */ keep,
      /** @type {import("./textbox.js").Outline[]} */ texts,
      /** @type {Fill} */ background,
    ) {
      return /** @type {Scope} */ ({
        doc,
        scheme,
        background,
        masterShapes,
        masterPlaceholder: (p) =>
          (owner ?? master)?.placeholders.get(p) ?? main?.placeholders.get(masterPlacement(p)),
        keep,
        outline: texts,
        context: (type) => ({
          levels: chainFor(type, defaults, envStyles, main?.styles),
          scheme,
          fonts,
          slideNumber: number,
          footer: hf?.footer ?? "",
          header: hf?.header ?? "",
          date: hf
            ? hf.flags & 4
              ? hf.date
              : hf.flags & 2
                ? new Date().toLocaleDateString()
                : ""
            : "",
        }),
        blipKind: image.kind,
      });
    }
    const masterBackground = backgroundOf(master);
    /** @type {SlideElement[]} */
    const elements = [];
    if (flags & 1 && master) {
      const layers = master.main ? [master] : [...(master.flags & 1 ? [main] : []), master];
      for (const m of layers)
        if (m)
          elements.push(
            ...readDrawing(
              m.drawing,
              scopeFor(m, m === master ? shows : () => false, [], masterBackground),
            ),
          );
    }
    const scope = scopeFor(undefined, () => true, outline, masterBackground);
    const own = readDrawing(drawing, scope);
    // A slide whose drawing holds nothing (an outline-only entry) still shows its outline text.
    elements.push(
      ...(own.length || !outline.length
        ? own
        : fallbackSlide(doc, outline, i + 1, width, height).elements),
    );
    const heading = elements.find(
      (e) => e.type === "shape" && (e.placeholder === "title" || e.placeholder === "ctrTitle"),
    );
    const info = childOf(doc, container, T.slideShowInfo);
    return {
      number: i + 1,
      title: heading?.type === "shape" ? plainText(heading.text).replace(/\s+/g, " ").trim() : "",
      hidden: info ? Boolean(u16(doc, info.body + 10) & 0x4) : false,
      background: (flags & 4 ? null : backgroundIn(drawing, scope)) ?? masterBackground,
      elements,
      notes:
        notes.byId.get(slideAtom ? u32(doc, slideAtom.body + 16) : -1) ??
        notes.bySlide.get(entry.id) ??
        "",
    };
  });
  return { format, size: { width, height }, slides, textOnly: false, image: image.url };
}

/** A FontEntityAtom's face name. @param {Uint8Array} b @param {PptRecord} rec */
function faceName(b, rec) {
  let s = "";
  for (let i = 0; i < 32; i++) {
    const c = u16(b, rec.body + i * 2);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** The colour scheme a slide or master uses (instance 1; masters also list others). */
function schemeIn(/** @type {Uint8Array} */ b, /** @type {PptRecord} */ container) {
  return schemeOf(
    b,
    childrenOf(b, container).find((r) => r.type === T.colorScheme && r.inst === 1) ?? null,
  );
}

/** A container's TextMasterStyleAtoms by text type. @param {Uint8Array} b @param {PptRecord | null} container */
function stylesIn(b, container) {
  /** @type {Map<number, Level[]>} */
  const out = new Map();
  for (const rec of childrenOf(b, container))
    if (rec.type === T.textMasterStyle) out.set(rec.inst, masterLevels(b, rec));
  return out;
}

/**
 * The levels a text of a type inherits, lowest first: the document's defaults, the environment's
 * styles and the master's, a centred title over the title, the other bodies over the body.
 * @param {number} type @param {Level[]} defaults @param {Map<number, Level[]>} env
 * @param {Map<number, Level[]> | undefined} master @returns {Level[][]}
 */
function chainFor(type, defaults, env, master) {
  const bases =
    type === 0 || type === 6
      ? [0, type]
      : type === 1 || type >= 5
        ? [1, type]
        : [type === 3 ? 4 : type];
  const unique = [...new Set(bases)];
  return [
    defaults,
    ...(type === 4 ? [env.get(4)] : []),
    ...unique.map((t) => master?.get(t)),
  ].filter((l) => l !== undefined);
}

/** A HeadersFootersContainer of an instance: its flags and strings. @returns {HeadersFooters | null} */
function headersFootersIn(
  /** @type {Uint8Array} */ b,
  /** @type {PptRecord} */ container,
  /** @type {number} */ inst,
) {
  const hf = childrenOf(b, container).find((r) => r.type === T.headersFooters && r.inst === inst);
  if (!hf) return null;
  const atom = childOf(b, hf, T.headersFootersAtom);
  const text = (/** @type {number} */ i) => {
    const rec = childrenOf(b, hf).find((r) => r.type === T.cString && r.inst === i);
    return rec ? new TextDecoder("utf-16le").decode(b.subarray(rec.body, rec.body + rec.len)) : "";
  };
  return {
    flags: atom ? u16(b, atom.body + 2) : 0,
    date: text(0),
    header: text(1),
    footer: text(2),
  };
}

/** Notes text by the notes page's own id, and by the id of the slide it belongs to. */
function notesOf(
  /** @type {Uint8Array} */ b,
  /** @type {Array<{ persist: number, id: number, records: PptRecord[] }>} */ list,
  /** @type {(persist: number) => PptRecord | null} */ at,
) {
  /** @type {Map<number, string>} */
  const byId = new Map();
  /** @type {Map<number, string>} */
  const bySlide = new Map();
  for (const entry of list) {
    const container = at(entry.persist);
    if (!container || container.type !== T.notes) continue;
    const outline = outlinesOf(b, entry.records);
    const drawing = childOf(b, container, T.drawing);
    const texts = (drawing ? descendants(b, drawing) : [])
      .filter((r) => r.type === T.clientTextbox)
      .map((box) => readText(b, box, null, outline))
      .filter((t) => t?.type === 2)
      .map((t) => (t?.text ?? "").replace(/[\r\v]/g, "\n"));
    const text = texts.join("\n").trim();
    byId.set(entry.id, text);
    bySlide.set(u32(b, childOf(b, container, T.notesAtom)?.body ?? 0), text);
  }
  return { byId, bySlide };
}

/** The BLIP store: each picture's kind, and its data: URL when the renderer asks. */
function imagesOf(
  /** @type {Uint8Array} */ doc,
  /** @type {PptRecord} */ docRec,
  /** @type {Uint8Array | null} */ pictures,
) {
  const store = descendants(doc, childOf(doc, docRec, T.drawingGroup) ?? docRec).find(
    (r) => r.type === T.bstore,
  );
  const blips = store ? childrenOf(doc, store) : [];
  const url = imageCache(async (id) => {
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
  const kind = (/** @type {number} */ pib) => {
    const rec = blips[pib - 1];
    if (!rec) return "";
    const type = rec.type === T.fbse ? (doc[rec.body] ?? 0) : rec.type - 0xf018;
    return type === 2 ? "emf" : type === 3 ? "wmf" : type === 4 ? "pict" : "bitmap";
  };
  return { url, kind };
}
