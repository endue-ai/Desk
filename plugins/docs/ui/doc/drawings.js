// Floating shapes ([MS-DOC] 2.8.27 PlcfSpa, 2.9.171 OfficeArtContent): the anchors in the text,
// the shapes of each drawing with their groups, sizes, pictures and text boxes, and the BLIP store
// whose pictures live in the WordDocument stream ([MS-ODRAW] 2.2.20, 2.2.32).
import { Reader } from "../bytes.js";
import { pt } from "../model.js";
import { PAIR, readPlc } from "./fib.js";
import { blipOf, record, records, shapeProps } from "./pictures.js";

/**
 * @typedef {import("./pictures.js").ShapeProps & { spid: number, children: number[], shareX?: number, shareY?: number }} Shape
 *   shareX, shareY: a group member's width and height as shares of its group's.
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 */

/**
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {import("./fib.js").Fib} fib
 */
export function readDrawings(wd, table, fib) {
  const r = new Reader(table);
  /** @type {Map<number, Shape>} */
  const shapes = new Map();
  /** @type {Array<() => import("./pictures.js").Blip>} */
  const store = [];
  const { fc, lcb } = fib.pair(PAIR.dggInfo);
  const end = Math.min(table.length, fc + lcb);
  if (lcb >= 8) {
    const dgg = record(r, fc);
    for (const rec of records(r, dgg.body, Math.min(end, dgg.end))) {
      if (rec.type !== 0xf001) continue;
      for (const fbse of records(r, rec.body, rec.end)) store.push(storeEntry(wd, table, fbse));
    }
    let at = dgg.end;
    while (at + 9 <= end) {
      const dg = record(r, at + 1);
      if (dg.type !== 0xf002) break;
      for (const rec of records(r, dg.body, Math.min(end, dg.end)))
        if (rec.type === 0xf003 || rec.type === 0xf004) walk(r, rec, shapes, undefined);
      at = dg.end;
    }
  }

  /** @param {number} which PlcSpaMom or PlcSpaHdr */
  const anchorsOf = (which) => {
    const plc = readPlc(table, fib.pair(which), 26);
    /** @type {Map<number, { spid: number, width: number, height: number }>} */
    const out = new Map();
    for (let i = 0; i + 1 < plc.cps.length; i++) {
      const at = plc.data(i);
      out.set(plc.cps[i] ?? 0, {
        spid: r.i32(at),
        width: pt((r.i32(at + 12) - r.i32(at + 4)) / 20),
        height: pt((r.i32(at + 16) - r.i32(at + 8)) / 20),
      });
    }
    return out;
  };

  return {
    main: anchorsOf(PAIR.plcSpaMom),
    header: anchorsOf(PAIR.plcSpaHdr),
    shape: (/** @type {number} */ spid) => shapes.get(spid),
    /** The picture of BLIP store entry `pib` (1-based). */
    blip: (/** @type {number} */ pib) => store[pib - 1]?.(),
  };
}

/**
 * One file block of the BLIP store: an FBSE whose BLIP is embedded or at foDelay in the
 * WordDocument stream, or a bare BLIP. Decoded when first asked for.
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {import("./pictures.js").Rec} fbse
 */
function storeEntry(wd, table, fbse) {
  /** @type {import("./pictures.js").Blip | undefined} */
  let done;
  return () => {
    if (done) return done;
    const r = new Reader(table);
    if (fbse.type !== 0xf007) done = blipOf(table, fbse);
    else {
      const name = r.u8(fbse.body + 33);
      const inside = fbse.body + 36 + name;
      if (inside + 8 <= fbse.end) done = blipOf(table, record(r, inside));
      else {
        const w = new Reader(wd);
        const at = r.u32(fbse.body + 28);
        done = at + 8 <= wd.length ? blipOf(wd, record(w, at)) : { src: null, kind: "unknown" };
      }
    }
    return done;
  };
}

/**
 * Record the shapes of a shape or group container; a group's first shape is the group itself,
 * and its children are sized by their anchors in the group's coordinates.
 * @param {Reader} r
 * @param {import("./pictures.js").Rec} rec
 * @param {Map<number, Shape>} shapes
 * @param {{ box: Box, children: number[] } | undefined} group
 * @returns {number | undefined} the container's shape id
 */
function walk(r, rec, shapes, group) {
  const inside = records(r, rec.body, rec.end);
  if (rec.type === 0xf004) {
    const fsp = inside.find((x) => x.type === 0xf00a);
    if (!fsp) return undefined;
    const spid = r.u32(fsp.body);
    const box = boxOf(
      r,
      inside.find((x) => x.type === 0xf00f),
    );
    const textbox = inside.find((x) => x.type === 0xf00d);
    /** @type {Shape} */
    const shape = { spid, children: [], ...shapeProps(r, inside) };
    if (textbox && shape.txid === undefined) shape.txid = r.u32(textbox.body);
    if (group && box && group.box.w && group.box.h) {
      shape.shareX = box.w / group.box.w;
      shape.shareY = box.h / group.box.h;
    }
    shapes.set(spid, shape);
    return spid;
  }
  const [first, ...rest] = inside;
  if (!first) return undefined;
  const id = walk(r, first, shapes, group);
  const self = id === undefined ? undefined : shapes.get(id);
  const own = records(r, first.body, first.end);
  const box = boxOf(
    r,
    own.find((x) => x.type === 0xf009),
  ) ?? { x: 0, y: 0, w: 0, h: 0 };
  for (const child of rest) {
    const childId = walk(r, child, shapes, { box, children: self?.children ?? [] });
    if (childId !== undefined) self?.children.push(childId);
  }
  return id;
}

/** A rectangle record (FSPGR or child anchor): left, top, right, bottom. */
function boxOf(
  /** @type {Reader} */ r,
  /** @type {import("./pictures.js").Rec | undefined} */ rec,
) {
  if (!rec) return undefined;
  const x = r.i32(rec.body);
  const y = r.i32(rec.body + 4);
  return { x, y, w: r.i32(rec.body + 8) - x, h: r.i32(rec.body + 12) - y };
}

/** @typedef {ReturnType<typeof readDrawings>} Drawings */
