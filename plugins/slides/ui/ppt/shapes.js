// The OfficeArt drawing of a slide, master or notes page ([MS-ODRAW] 2.2.13-2.2.15, [MS-PPT] 2.5.9):
// groups with their child frames, shapes with type, anchor, rotation, flips, fill, line and text,
// placeholders that take what they lack from the master's, pictures, tables (table.js) and the
// background shape. No DOM.
import { boxOf, NO_FILL, paragraphOf, rect, runOf } from "../deck.js";
import { fillOf, lineOf, shapeColors } from "./fill.js";
import { geometryOf, isLine } from "./geometry.js";
import { fixed, flag, inherit, optionsOf, stringOf, value } from "./options.js";
import { anchorOf, childOf, childrenOf, T, u32 } from "./records.js";
import { readTable } from "./table.js";
import { bodyOf, paragraphsOf } from "./text.js";
import { readText } from "./textbox.js";

/**
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {import("./options.js").Options} Options
 * @typedef {import("./text.js").TextContext} TextContext
 * @typedef {import("./textbox.js").Outline} Outline
 * @typedef {{ ox: number, oy: number, sx: number, sy: number }} Frame  maps anchors to points
 * @typedef {{ opts: Options, anchor: number[] | null, placement: number }} MasterShape
 * @typedef {{
 *   doc: Uint8Array, scheme: string[], background: Fill,
 *   masterShapes: Map<number, MasterShape>,
 *   masterPlaceholder(placement: number): MasterShape | undefined,
 *   keep(placement: number): boolean,
 *   outline: Outline[],
 *   context(type: number): TextContext,
 *   blipKind(pib: number): string,
 * }} Scope
 *   keep: which placeholders to draw (masters draw only the footers a slide shows); outline: the
 *   texts of the slide's SlideListWithText entry; blipKind: "bitmap", "emf", "wmf", "pict" or "".
 */

/** PlaceholderEnum values as the model's placeholder types. */
const PLACEHOLDERS = /** @type {Record<number, string>} */ ({
  1: "title",
  2: "body",
  3: "ctrTitle",
  4: "subTitle",
  5: "sldImg",
  6: "body",
  7: "dt",
  8: "sldNum",
  9: "ftr",
  10: "hdr",
  11: "sldImg",
  12: "body",
  13: "title",
  14: "body",
  15: "ctrTitle",
  16: "subTitle",
  17: "title",
  18: "body",
  19: "obj",
  20: "chart",
  21: "tbl",
  22: "clipArt",
  23: "dgm",
  24: "media",
  25: "obj",
  26: "pic",
});

/** A slide's master placeholder for a slide's placeholder: title for titles, body for the rest. */
export const masterPlacement = (/** @type {number} */ p) =>
  p === 13 || p === 15 || p === 17 ? 1 : p === 16 ? 4 : p >= 14 ? 2 : p;

/** The top-level frame: master units, 576 an inch, as points. */
export const TOP = { ox: 0, oy: 0, sx: 1 / 8, sy: 1 / 8 };

/**
 * A box from an anchor: rotations of 45 to 135 and 225 to 315 degrees store the box turned a
 * quarter, so it is turned back about its centre first.
 * @param {number[]} anchor @param {Frame} frame @param {number} rot
 */
function boxIn(anchor, frame, rot) {
  let [l = 0, t = 0, r = 0, b = 0] = anchor;
  if ((rot >= 45 && rot < 135) || (rot >= 225 && rot < 315)) {
    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    const [hw, hh] = [(b - t) / 2, (r - l) / 2];
    [l, t, r, b] = [cx - hw, cy - hh, cx + hw, cy + hh];
  }
  return boxOf({
    x: (l - frame.ox) * frame.sx,
    y: (t - frame.oy) * frame.sy,
    w: (r - l) * frame.sx,
    h: (b - t) * frame.sy,
  });
}

/** The shape record of an SpContainer: type, id, flags. @param {Uint8Array} b @param {PptRecord | null} fsp */
const fspOf = (b, fsp) => ({
  type: fsp?.inst ?? 0,
  spid: fsp ? u32(b, fsp.body) : 0,
  flags: fsp ? u32(b, fsp.body + 4) : 0,
});

/** The placement of a placeholder (PlaceholderEnum), or 0. @param {Uint8Array} b @param {PptRecord | null} data */
export function placementOf(b, data) {
  const atom = childOf(b, data, T.placeholder);
  return atom ? (b[atom.body + 4] ?? 0) : 0;
}

/** The properties, anchor and placement of every shape in a drawing, by shape id (for masters). */
export function shapeTable(
  /** @type {Uint8Array} */ b,
  /** @type {PptRecord | null} */ drawing,
  /** @type {Map<number, MasterShape>} */ into,
) {
  const visit = (/** @type {PptRecord} */ rec, /** @type {number} */ depth) => {
    for (const child of childrenOf(b, rec)) {
      if (child.type === T.sp) {
        const kids = childrenOf(b, child);
        const { spid } = fspOf(b, kids.find((k) => k.type === T.fsp) ?? null);
        into.set(spid, {
          opts: optionsOf(b, [
            kids.find((k) => k.type === T.fopt),
            kids.find((k) => k.type === T.tertiaryFopt),
          ]),
          anchor: anchorOf(b, kids.find((k) => k.type === T.clientAnchor) ?? null),
          placement: placementOf(b, kids.find((k) => k.type === T.clientData) ?? null),
        });
      } else if (child.ver === 0xf && depth < 16) visit(child, depth + 1);
    }
  };
  if (drawing) visit(drawing, 0);
  return into;
}

/**
 * The fill of a drawing's background shape, or null when it has none.
 * @param {PptRecord | null} drawing @param {Scope} scope @returns {Fill | null}
 */
export function backgroundIn(drawing, scope) {
  const b = scope.doc;
  for (const rec of childrenOf(b, childOf(b, drawing, T.dg))) {
    if (rec.type !== T.sp) continue;
    const kids = childrenOf(b, rec);
    const { flags } = fspOf(b, kids.find((k) => k.type === T.fsp) ?? null);
    if (!(flags & 0x400)) continue;
    const opts = optionsOf(b, [
      kids.find((k) => k.type === T.fopt),
      kids.find((k) => k.type === T.tertiaryFopt),
    ]);
    return fillOf(opts, shapeColors(opts, scope.scheme));
  }
  return null;
}

/**
 * The elements of a drawing (a DrawingContainer), in drawing order.
 * @param {PptRecord | null} drawing @param {Scope} scope @returns {SlideElement[]}
 */
export function readDrawing(drawing, scope) {
  const b = scope.doc;
  return childrenOf(b, childOf(b, drawing, T.dg))
    .filter((rec) => rec.type === T.spgr)
    .flatMap((rec) => childrenIn(rec, TOP, scope, 0));
}

/** The shapes and groups in a group, its own shape (the first) left out. */
function childrenIn(
  /** @type {PptRecord} */ spgr,
  /** @type {Frame} */ frame,
  /** @type {Scope} */ scope,
  depth = 0,
) {
  /** @type {SlideElement[]} */
  const out = [];
  for (const [i, rec] of childrenOf(scope.doc, spgr).entries()) {
    if (i === 0) continue;
    try {
      const element =
        rec.type === T.spgr && depth < 16
          ? groupOf(rec, frame, scope, depth + 1)
          : rec.type === T.sp
            ? shapeOf(rec, frame, scope)
            : null;
      if (element) out.push(element);
    } catch {
      // A shape it cannot read is left out, not the slide.
    }
  }
  return out;
}

/** A group: its box, and its children in its frame (points from its top left). */
function groupOf(
  /** @type {PptRecord} */ spgr,
  /** @type {Frame} */ frame,
  /** @type {Scope} */ scope,
  /** @type {number} */ depth,
) {
  const b = scope.doc;
  const own = childrenOf(b, spgr)[0];
  const kids = own?.type === T.sp ? childrenOf(b, own) : [];
  const opts = optionsOf(b, [
    kids.find((k) => k.type === T.fopt),
    kids.find((k) => k.type === T.tertiaryFopt),
  ]);
  if (flag(opts, 0x03bf, 1)) return null;
  const { flags } = fspOf(b, kids.find((k) => k.type === T.fsp) ?? null);
  const rot = normal(fixed(opts, 0x0004));
  const anchor = anchorOf(
    b,
    kids.find((k) => k.type === T.clientAnchor || k.type === T.childAnchor) ?? null,
  );
  const [gl = 0, gt = 0, gr = 0, gb = 0] =
    anchorOf(b, kids.find((k) => k.type === T.spgrAtom) ?? null) ?? [];
  const box = anchor ? boxIn(anchor, frame, rot) : boxOf();
  box.rot = rot;
  box.flipH = Boolean(flags & 0x40);
  box.flipV = Boolean(flags & 0x80);
  /** @type {Frame} */
  const inner = {
    ox: gl,
    oy: gt,
    sx: gr - gl ? box.w / (gr - gl) : frame.sx,
    sy: gb - gt ? box.h / (gb - gt) : frame.sy,
  };
  if (value(opts, 0x039f) & 1) {
    const table = readTable(spgr, box, inner, scope, shapeOf);
    if (table) return table;
  }
  return /** @type {SlideElement} */ ({
    type: "group",
    name: stringOf(opts, 0x0380) || "Group",
    box,
    children: childrenIn(spgr, inner, scope, depth),
  });
}

/** Degrees in 0..360. @param {number} deg */
const normal = (deg) => ((deg % 360) + 360) % 360;

/**
 * One shape: a picture, or a shape with its geometry, fill, line and text. Null for a hidden shape,
 * a deleted one or a placeholder the scope does not keep.
 * @param {PptRecord} sp @param {Frame} frame @param {Scope} scope @returns {SlideElement | null}
 */
export function shapeOf(sp, frame, scope) {
  const b = scope.doc;
  const kids = childrenOf(b, sp);
  const find = (/** @type {number} */ type) => kids.find((k) => k.type === type) ?? null;
  const { type: own, flags } = fspOf(b, find(T.fsp));
  if (flags & 0x08) return null;
  const data = find(T.clientData);
  const placement = placementOf(b, data);
  if (placement && !scope.keep(placement)) return null;
  const mine = optionsOf(b, [find(T.fopt), find(T.tertiaryFopt)]);
  const master =
    (flags & 0x20 ? scope.masterShapes.get(value(mine, 0x0301)) : undefined) ??
    (placement ? scope.masterPlaceholder(masterPlacement(placement)) : undefined);
  const opts = inherit(mine, master?.opts);
  if (flag(opts, 0x03bf, 1)) return null;
  const type = own;
  const rot = normal(fixed(opts, 0x0004));
  const anchor = anchorOf(b, find(T.clientAnchor) ?? find(T.childAnchor)) ?? master?.anchor;
  const box = anchor ? boxIn(anchor, frame, rot) : boxOf();
  box.rot = rot;
  box.flipH = Boolean(flags & 0x40);
  box.flipV = Boolean(flags & 0x80);
  const colors = shapeColors(opts, scope.scheme);
  const line = lineOf(opts, colors);
  const name = stringOf(opts, 0x0380);
  const pib = value(opts, 0x0104);
  if (pib) {
    const kind = scope.blipKind(pib);
    const label =
      stringOf(opts, 0x0381) ||
      name ||
      (flags & 0x10
        ? "Embedded object"
        : kind === "emf" || kind === "wmf"
          ? "Windows Metafile picture"
          : kind === "pict"
            ? "Macintosh PICT picture"
            : "Picture");
    return /** @type {SlideElement} */ ({
      type: "picture",
      name: name || "Picture",
      box,
      image: kind === "bitmap" ? `pib:${pib}` : null,
      crop: {
        top: fixed(opts, 0x0100),
        bottom: fixed(opts, 0x0101),
        left: fixed(opts, 0x0102),
        right: fixed(opts, 0x0103),
      },
      line: flag(opts, 0x01ff, 3) ? line : null,
      geometry: rect(),
      label,
    });
  }
  const text = readText(b, find(T.clientTextbox), data, scope.outline);
  const fill = isLine(type) ? NO_FILL : fillOf(opts, colors, scope.background);
  const art = stringOf(opts, 0x00c0);
  if (art && !text) return wordArt(art, opts, box, fill, line, name);
  const body = text ? bodyOf(paragraphsOf(text, scope.context(text.type)), opts) : null;
  return /** @type {SlideElement} */ ({
    type: "shape",
    name: name || (placement ? (PLACEHOLDERS[placement] ?? "Placeholder") : "Shape"),
    box,
    geometry: geometryOf(type, opts, box.w, box.h),
    fill,
    line,
    text: body?.paragraphs.some((p) => p.runs.some((r) => r.text !== "")) ? body : null,
    placeholder: placement ? (PLACEHOLDERS[placement] ?? "") : "",
  });
}

/**
 * WordArt (gtextUNICODE): its text in its font, centred in its box, the shape's fill and line
 * drawn as the letters' colour and nothing around them. The model has no text effects: the text
 * is laid out flat at the size that fits the box's height.
 */
function wordArt(
  /** @type {string} */ art,
  /** @type {Options} */ opts,
  /** @type {Box} */ box,
  /** @type {Fill} */ fill,
  /** @type {import("../deck.js").Line | null} */ line,
  /** @type {string} */ name,
) {
  const lines = art.replace(/\r?\n$/, "").split(/\r?\n/);
  const color =
    fill.type === "solid"
      ? fill.color
      : fill.type === "gradient"
        ? (fill.stops[0]?.color ?? "#000000")
        : (line?.color ?? "#000000");
  const size = Math.max(4, Math.min(fixed(opts, 0x00c3, 36), (box.h / lines.length) * 0.8));
  const run = {
    size,
    bold: flag(opts, 0x00ff, 5) === true,
    italic: flag(opts, 0x00ff, 4) === true,
    color,
    font: stringOf(opts, 0x00c5),
  };
  return /** @type {SlideElement} */ ({
    type: "shape",
    name: name || "WordArt",
    box,
    geometry: { name: "rect", adjust: {} },
    fill: NO_FILL,
    line: null,
    text: bodyOf(
      lines.map((l) => paragraphOf([runOf(l, run)], { align: "center" })),
      new Map([[0x0087, { value: 1, data: null }]]),
    ),
    placeholder: "",
  });
}
