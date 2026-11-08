// Lists ([MS-DOC] 2.4.6.3, 2.4.6.4): the list definitions (PlfLst: LSTF and their LVLs), the list
// overrides paragraphs point to (PlfLfo: LFO, LFOData, LFOLVL), counters kept per list as Word keeps
// them, and the number text each numbered paragraph begins with.
import { decode, Reader } from "../bytes.js";
import { bullet, formatNumber } from "../numbers.js";
import { PAIR } from "./fib.js";

/**
 * @typedef {{ start: number, nfc: number, legal: boolean, noRestart: boolean, restartLim: number, nums: number[], text: string, papx: Uint8Array, chpx: Uint8Array }} Level
 * @typedef {{ lsid: number, levels: Level[], styles: number[] }} List
 * @typedef {{ lsid: number, overrides: Map<number, { start?: number, level?: Level }> }} Override
 */

/** MSONFC ([MS-OSHARED] 2.2.1.3) to the styles numbers.js formats. */
const NFC = /** @type {Record<number, string>} */ ({
  0: "decimal",
  1: "upperRoman",
  2: "lowerRoman",
  3: "upperLetter",
  4: "lowerLetter",
  10: "ideographDigital",
  11: "japaneseCounting",
  18: "decimalEnclosedCircle",
  22: "decimalZero",
  24: "ganada",
  25: "chosung",
  27: "decimalEnclosedParen",
  37: "chineseCounting",
  39: "chineseCountingThousand",
  41: "koreanDigital",
  255: "none",
});

const BULLET = 0x17;

/**
 * One LVL ([MS-DOC] 2.9.149): the LVLF, grpprlPapx, grpprlChpx, then the number text.
 * @param {Uint8Array} table
 * @param {number} at
 * @returns {{ level: Level, end: number }}
 */
function readLevel(table, at) {
  const r = new Reader(table);
  const flags = r.u8(at + 5);
  /** @type {number[]} */
  const nums = [];
  for (let i = 0; i < 9; i++) {
    const n = r.u8(at + 6 + i);
    if (!n) break;
    nums.push(n);
  }
  const cbChpx = r.u8(at + 24);
  const cbPapx = r.u8(at + 25);
  let p = at + 28;
  const papx = table.subarray(p, p + cbPapx);
  p += cbPapx;
  const chpx = table.subarray(p, p + cbChpx);
  p += cbChpx;
  const cch = Math.min(r.u16(p), 255);
  const text = decode(table.subarray(p + 2, p + 2 + cch * 2), "utf-16le");
  return {
    level: {
      start: r.i32(at),
      nfc: r.u8(at + 4),
      legal: (flags & 0x04) !== 0,
      noRestart: (flags & 0x08) !== 0,
      restartLim: r.u8(at + 26),
      nums,
      text,
      papx,
      chpx,
    },
    end: p + 2 + cch * 2,
  };
}

/**
 * @param {Uint8Array} table
 * @param {import("./fib.js").Fib} fib
 * @param {(ftc: number) => string} fontOf
 * @param {(chpx: Uint8Array) => number} ftcOf the font a level's character properties pick
 */
export function readLists(table, fib, fontOf, ftcOf) {
  const r = new Reader(table);
  /** @type {Map<number, List>} */
  const lists = new Map();
  const lst = fib.pair(PAIR.plfLst);
  if (lst.lcb >= 2) {
    const count = Math.max(0, r.i16(lst.fc));
    let at = lst.fc + 2 + count * 28;
    for (let i = 0; i < count; i++) {
      const base = lst.fc + 2 + i * 28;
      const simple = (r.u8(base + 26) & 1) !== 0;
      /** @type {Level[]} */
      const levels = [];
      for (let l = 0; l < (simple ? 1 : 9) && at < table.length; l++) {
        const read = readLevel(table, at);
        levels.push(read.level);
        at = read.end;
      }
      const styles = Array.from({ length: 9 }, (_, l) => r.u16(base + 8 + l * 2));
      lists.set(r.i32(base), { lsid: r.i32(base), levels, styles });
    }
  }
  /** @type {Override[]} */
  const lfos = [];
  const lfo = fib.pair(PAIR.plfLfo);
  if (lfo.lcb >= 4) {
    const count = Math.min(r.u32(lfo.fc), 0x7fe);
    let at = lfo.fc + 4 + count * 16;
    for (let i = 0; i < count; i++) {
      const base = lfo.fc + 4 + i * 16;
      const levels = r.u8(base + 12);
      /** @type {Override["overrides"]} */
      const overrides = new Map();
      at += 4;
      for (let l = 0; l < levels && at < table.length; l++) {
        const start = r.i32(at);
        const bits = r.u32(at + 4);
        const ilvl = bits & 0x0f;
        at += 8;
        /** @type {{ start?: number, level?: Level }} */
        const over = {};
        if (bits & 0x10) over.start = start;
        if (bits & 0x20) {
          const read = readLevel(table, at);
          over.level = read.level;
          at = read.end;
        }
        overrides.set(ilvl, over);
      }
      lfos.push({ lsid: r.i32(base), overrides });
    }
  }

  /** Counters per list; an override restarts its list on its first use. */
  /** @type {Map<number, Array<number | undefined>>} */
  const counters = new Map();
  /** @type {Set<number>} */
  const started = new Set();

  /**
   * The next paragraph of list override `ilfo` at level `ilvl`: its number text, and the
   * paragraph and character properties the level gives.
   * @param {number} ilfo 1-based
   * @param {number} ilvl
   */
  const next = (ilfo, ilvl) => {
    const over = lfos[ilfo - 1];
    const list = over ? lists.get(over.lsid) : undefined;
    if (!over || !list) return undefined;
    const levelAt = (/** @type {number} */ i) =>
      over.overrides.get(i)?.level ?? list.levels[list.levels.length === 1 ? 0 : i];
    const level = levelAt(ilvl);
    if (!level) return undefined;
    const counts = counters.get(list.lsid) ?? [];
    counters.set(list.lsid, counts);
    if (!started.has(ilfo)) {
      started.add(ilfo);
      for (const [i, o] of over.overrides) if (o.start !== undefined) counts[i] = o.start - 1;
    }
    const startOf = (/** @type {number} */ i) => levelAt(i)?.start ?? 1;
    if (level.nfc !== BULLET && level.nfc !== 255)
      counts[ilvl] = (counts[ilvl] ?? startOf(ilvl) - 1) + 1;
    for (let i = ilvl + 1; i < 9; i++) {
      const deeper = levelAt(i);
      if (!deeper?.noRestart || ilvl < deeper.restartLim) counts[i] = undefined;
    }
    let text = level.text;
    if (level.nfc === BULLET) text = bullet(text.slice(0, 1), fontOf(ftcOf(level.chpx)));
    else {
      const chars = text.split("");
      for (const n of level.nums) {
        const i = (chars[n - 1] ?? "").charCodeAt(0);
        if (!(i >= 0 && i < 9)) continue;
        const at = levelAt(i);
        const style = level.legal && at?.nfc !== 22 ? "decimal" : (NFC[at?.nfc ?? 0] ?? "decimal");
        chars[n - 1] = formatNumber(counts[i] ?? startOf(i), style);
      }
      text = chars.join("");
    }
    return { text, papx: level.papx, chpx: level.chpx, istd: list.styles[ilvl] ?? 0x0fff };
  };

  return { next };
}

/** @typedef {ReturnType<typeof readLists>} Lists */
