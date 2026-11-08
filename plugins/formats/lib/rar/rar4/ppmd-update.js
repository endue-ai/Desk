// The context tree of a PPMd var.H model: restart, new contexts for a found symbol, the update after
// each symbol and rescaling, after the public-domain PPMd var.H by Dmitry Shkarin and Igor Pavlov's
// LZMA SDK (Ppmd7), as carried by libarchive.
//
// A context is one unit: NumStats u16, SummFreq u16, Stats u32, Suffix u32. A state is 6 bytes: Symbol
// u8, Freq u8, Successor as two u16 halves. A context with one state keeps it at offset 2, in place of
// SummFreq and Stats (OneState). A successor below the text pointer still points into the text.

import { SubAllocator, UNIT_SIZE } from "./ppmd-memory.js";

export const MAX_FREQ = 124;
export const BIN_SCALE = 1 << 14;
export const PERIOD_BITS = 7;
/** The SEE slot of contexts with all 256 symbols (DummySee), after the 25 x 16 real ones. */
export const DUMMY_SEE = 25 * 16;
const MAX_ORDER = 64;
const INIT_BIN_ESC = [0x3cdd, 0x1f3f, 0x59bf, 0x48f3, 0x64a1, 0x5abc, 0x6632, 0x6051];

/** @param {Uint16Array} u16 @param {number} s */
export function successorOf(u16, s) {
  const h = s >> 1;
  return u16[h + 1] | (u16[h + 2] << 16);
}

/** @param {Uint16Array} u16 @param {number} s @param {number} v */
function setSuccessor(u16, s, v) {
  const h = s >> 1;
  u16[h + 1] = v & 0xffff;
  u16[h + 2] = v >>> 16;
}

/** @param {Uint16Array} u16 @param {number} dst @param {number} src */
function copyState(u16, dst, src) {
  const d = dst >> 1;
  const s = src >> 1;
  u16[d] = u16[s];
  u16[d + 1] = u16[s + 1];
  u16[d + 2] = u16[s + 2];
}

/** @param {Uint16Array} u16 @param {number} a @param {number} b */
export function swapStates(u16, a, b) {
  const x = a >> 1;
  const y = b >> 1;
  const t0 = u16[x];
  const t1 = u16[x + 1];
  const t2 = u16[x + 2];
  u16[x] = u16[y];
  u16[x + 1] = u16[y + 1];
  u16[x + 2] = u16[y + 2];
  u16[y] = t0;
  u16[y + 1] = t1;
  u16[y + 2] = t2;
}

export class ContextTree extends SubAllocator {
  constructor() {
    super();
    this.minContext = 0;
    this.maxContext = 0;
    this.foundState = 0;
    this.orderFall = 0;
    this.initEsc = 0;
    this.prevSuccess = 0;
    this.maxOrder = 0;
    this.hiBitsFlag = 0;
    this.runLength = 0;
    this.initRL = 0;
    /** Binary-context probabilities, [Freq - 1][0..63]. */
    this.binSumm = new Uint16Array(128 * 64);
    /** SEE contexts, [25][16] then DummySee: Summ, Shift and Count. */
    this.seeSumm = new Uint16Array(DUMMY_SEE + 1);
    this.seeShift = new Uint8Array(DUMMY_SEE + 1);
    this.seeCount = new Uint8Array(DUMMY_SEE + 1);
    /** States that get a new context in createSuccessors. */
    this.upStates = new Uint32Array(MAX_ORDER + 1);
  }

  /** Forgets everything: one order-0 context holding all 256 symbols (RestartModel). */
  restartModel() {
    this.initUnits();
    const { u8, u16, u32 } = this;
    const maxOrder = this.maxOrder;
    this.orderFall = maxOrder;
    this.initRL = -Math.min(maxOrder, 12) - 1;
    this.runLength = this.initRL;
    this.prevSuccess = 0;
    this.hiUnit -= UNIT_SIZE;
    const root = this.hiUnit;
    this.minContext = root;
    this.maxContext = root;
    u32[(root + 8) >> 2] = 0;
    u16[root >> 1] = 256;
    u16[(root + 2) >> 1] = 257;
    const stats = this.loUnit;
    this.foundState = stats;
    this.loUnit += 128 * UNIT_SIZE;
    u32[(root + 4) >> 2] = stats;
    for (let i = 0; i < 256; i++) {
      const s = stats + i * 6;
      u8[s] = i;
      u8[s + 1] = 1;
      setSuccessor(u16, s, 0);
    }
    const binSumm = this.binSumm;
    for (let i = 0; i < 128; i++) {
      for (let k = 0; k < 8; k++) {
        const value = BIN_SCALE - Math.floor(/** @type {number} */ (INIT_BIN_ESC[k]) / (i + 2));
        for (let m = 0; m < 64; m += 8) binSumm[i * 64 + k + m] = value;
      }
    }
    for (let i = 0; i < 25; i++) {
      for (let k = 0; k < 16; k++) {
        this.seeShift[i * 16 + k] = PERIOD_BITS - 4;
        this.seeSumm[i * 16 + k] = (5 * i + 10) << (PERIOD_BITS - 4);
        this.seeCount[i * 16 + k] = 4;
      }
    }
  }

  /**
   * Gives the found symbol real contexts along the suffixes whose successors still point into the
   * text (CreateSuccessors). Returns the highest of them, or 0 when memory is full.
   * @param {boolean} skip
   */
  createSuccessors(skip) {
    const { u8, u16, u32, upStates } = this;
    const fs = this.foundState;
    const symbol = u8[fs];
    const upBranch = successorOf(u16, fs);
    let c = this.minContext;
    let numPs = 0;
    if (!skip) upStates[numPs++] = fs;
    for (let suffix = u32[(c + 8) >> 2]; suffix !== 0; suffix = u32[(c + 8) >> 2]) {
      c = suffix;
      let s = c + 2;
      if (u16[c >> 1] !== 1) {
        s = u32[(c + 4) >> 2];
        while (u8[s] !== symbol) s += 6;
      }
      const successor = successorOf(u16, s);
      if (successor !== upBranch) {
        c = successor;
        if (numPs === 0) return c;
        break;
      }
      upStates[numPs++] = s;
    }
    const upSymbol = u8[upBranch];
    let upFreq = 0;
    if (u16[c >> 1] === 1) upFreq = u8[c + 3];
    else {
      let s = u32[(c + 4) >> 2];
      while (u8[s] !== upSymbol) s += 6;
      const cf = u8[s + 1] - 1;
      const s0 = u16[(c + 2) >> 1] - u16[c >> 1] - cf;
      if (2 * cf <= s0) upFreq = 5 * cf > s0 ? 2 : 1;
      else upFreq = 1 + Math.floor((2 * cf + 3 * s0 - 1) / (2 * s0));
    }
    while (numPs !== 0) {
      const c1 = this.allocContext();
      if (c1 === 0) return 0;
      u16[c1 >> 1] = 1;
      u8[c1 + 2] = upSymbol;
      u8[c1 + 3] = upFreq;
      setSuccessor(u16, c1 + 2, upBranch + 1);
      u32[(c1 + 8) >> 2] = c;
      setSuccessor(u16, /** @type {number} */ (upStates[--numPs]), c1);
      c = c1;
    }
    return c;
  }

  /** Adds the found symbol to the contexts it escaped from and moves on (UpdateModel). */
  updateModel() {
    const { u8, u16, u32 } = this;
    const fs = this.foundState;
    const symbol = u8[fs];
    const freq = u8[fs + 1];
    const minContext = this.minContext;
    const suffix = u32[(minContext + 8) >> 2];
    let fSuccessor = successorOf(u16, fs);
    if (freq < MAX_FREQ / 4 && suffix !== 0) {
      if (u16[suffix >> 1] === 1) {
        if (u8[suffix + 3] < 32) u8[suffix + 3]++;
      } else {
        let s = u32[(suffix + 4) >> 2];
        if (u8[s] !== symbol) {
          do s += 6;
          while (u8[s] !== symbol);
          if (u8[s + 1] >= u8[s - 5]) {
            swapStates(u16, s, s - 6);
            s -= 6;
          }
        }
        if (u8[s + 1] < MAX_FREQ - 9) {
          u8[s + 1] += 2;
          u16[(suffix + 2) >> 1] += 2;
        }
      }
    }
    if (this.orderFall === 0) {
      const c = this.createSuccessors(true);
      this.minContext = c;
      this.maxContext = c;
      if (c === 0) this.restartModel();
      else setSuccessor(u16, this.foundState, c);
      return;
    }
    u8[this.text++] = symbol;
    let successor = this.text;
    if (successor >= this.unitsStart) return this.restartModel();
    if (fSuccessor !== 0) {
      if (fSuccessor <= successor) {
        fSuccessor = this.createSuccessors(false);
        if (fSuccessor === 0) return this.restartModel();
      }
      if (--this.orderFall === 0) {
        successor = fSuccessor;
        if (this.maxContext !== minContext) this.text--;
      }
    } else {
      setSuccessor(u16, fs, successor);
      fSuccessor = minContext;
    }
    const ns = u16[minContext >> 1];
    const s0 = u16[(minContext + 2) >> 1] - ns - (freq - 1);
    for (let c = this.maxContext; c !== minContext; c = u32[(c + 8) >> 2]) {
      const ns1 = u16[c >> 1];
      const sumAt = (c + 2) >> 1;
      if (ns1 !== 1) {
        if ((ns1 & 1) === 0) {
          const stats = this.expandUnits(u32[(c + 4) >> 2], ns1 >> 1);
          if (stats === 0) return this.restartModel();
          u32[(c + 4) >> 2] = stats;
        }
        const sum = u16[sumAt];
        u16[sumAt] = sum + (2 * ns1 < ns ? 1 : 0) + (4 * ns1 <= ns && sum <= 8 * ns1 ? 2 : 0);
      } else {
        const s = this.allocUnits(0);
        if (s === 0) return this.restartModel();
        copyState(u16, s, c + 2);
        u32[(c + 4) >> 2] = s;
        const f = u8[s + 1];
        u8[s + 1] = f < MAX_FREQ / 4 - 1 ? f << 1 : MAX_FREQ - 4;
        u16[sumAt] = u8[s + 1] + this.initEsc + (ns > 3 ? 1 : 0);
      }
      let cf = 2 * freq * (u16[sumAt] + 6);
      const sf = s0 + u16[sumAt];
      if (cf < 6 * sf) {
        cf = 1 + (cf > sf ? 1 : 0) + (cf >= 4 * sf ? 1 : 0);
        u16[sumAt] += 3;
      } else {
        cf = 4 + (cf >= 9 * sf ? 1 : 0) + (cf >= 12 * sf ? 1 : 0) + (cf >= 15 * sf ? 1 : 0);
        u16[sumAt] += cf;
      }
      const s = u32[(c + 4) >> 2] + ns1 * 6;
      setSuccessor(u16, s, successor);
      u8[s] = symbol;
      u8[s + 1] = cf;
      u16[c >> 1] = ns1 + 1;
    }
    this.maxContext = fSuccessor;
    this.minContext = fSuccessor;
  }

  /** Halves the frequencies of the current context and drops states that reach 0 (Rescale). */
  rescale() {
    const { u8, u16, u32 } = this;
    const mc = this.minContext;
    const stats = u32[(mc + 4) >> 2];
    let s = this.foundState;
    // The found state moves to the front.
    const h = s >> 1;
    const t0 = u16[h];
    const t1 = u16[h + 1];
    const t2 = u16[h + 2];
    for (; s !== stats; s -= 6) copyState(u16, s, s - 6);
    u16[s >> 1] = t0;
    u16[(s >> 1) + 1] = t1;
    u16[(s >> 1) + 2] = t2;
    let escFreq = u16[(mc + 2) >> 1] - u8[s + 1];
    const adder = this.orderFall !== 0 ? 1 : 0;
    u8[s + 1] = (((u8[s + 1] + 4) & 0xff) + adder) >> 1;
    let sumFreq = u8[s + 1];
    let i = u16[mc >> 1] - 1;
    do {
      s += 6;
      escFreq -= u8[s + 1];
      const f = (u8[s + 1] + adder) >> 1;
      u8[s + 1] = f;
      sumFreq += f;
      if (f > u8[s - 5]) {
        // Insertion sort by frequency, highest first.
        let s1 = s;
        const k = s1 >> 1;
        const k0 = u16[k];
        const k1 = u16[k + 1];
        const k2 = u16[k + 2];
        do {
          copyState(u16, s1, s1 - 6);
          s1 -= 6;
        } while (s1 !== stats && f > u8[s1 - 5]);
        u16[s1 >> 1] = k0;
        u16[(s1 >> 1) + 1] = k1;
        u16[(s1 >> 1) + 2] = k2;
      }
    } while (--i);
    if (u8[s + 1] === 0) {
      const numStats = u16[mc >> 1];
      i = 0;
      do {
        i++;
        s -= 6;
      } while (u8[s + 1] === 0);
      escFreq += i;
      const ns = numStats - i;
      u16[mc >> 1] = ns;
      if (ns === 1) {
        const symbol = u8[stats];
        let freq = u8[stats + 1];
        const lo = u16[(stats >> 1) + 1];
        const hi = u16[(stats >> 1) + 2];
        let esc = escFreq >>> 0;
        do {
          freq -= freq >> 1;
          esc >>>= 1;
        } while (esc > 1);
        this.freeUnits(stats, (numStats + 1) >> 1);
        const one = mc + 2;
        this.foundState = one;
        u8[one] = symbol;
        u8[one + 1] = freq;
        u16[(one >> 1) + 1] = lo;
        u16[(one >> 1) + 2] = hi;
        return;
      }
      const n0 = (numStats + 1) >> 1;
      const n1 = (ns + 1) >> 1;
      if (n0 !== n1) u32[(mc + 4) >> 2] = this.shrinkUnits(stats, n0, n1);
    }
    u16[(mc + 2) >> 1] = sumFreq + escFreq - (escFreq >> 1);
    this.foundState = u32[(mc + 4) >> 2];
  }
}
