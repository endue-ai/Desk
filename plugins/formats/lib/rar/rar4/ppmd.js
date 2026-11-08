// PPMd variant H, the text compression of RAR 2.9 to 4.x, decoding with RAR's range coder, after the
// public-domain PPMd var.H by Dmitry Shkarin and Igor Pavlov's LZMA SDK (Ppmd7), as carried by
// libarchive. This file holds symbol decoding: contexts with many states, binary contexts with one,
// escapes to shorter contexts through SEE, and the frequency updates after each symbol. The tree and
// its memory live in ppmd-update.js and ppmd-memory.js.

import {
  BIN_SCALE,
  ContextTree,
  DUMMY_SEE,
  MAX_FREQ,
  PERIOD_BITS,
  successorOf,
  swapStates,
} from "./ppmd-update.js";

/** @typedef {import("./ppmd-range.js").RangeDecoder} RangeDecoder */

const MIN_MEMORY = 1 << 11;
const MAX_MEMORY = 0x7fffffff - 64;
const EXP_ESCAPE = Uint8Array.of(25, 14, 9, 7, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2);
/** SEE row by the number of states an escape left, at that number - 1. */
const NS2INDX = new Uint8Array(256);
/** Binary-context column by the suffix's NumStats, at NumStats - 1. */
const NS2BSINDX = new Uint8Array(256);
/** 8 for symbols 0x40 and up. */
const HB2FLAG = new Uint8Array(256);
for (let i = 0; i < 3; i++) NS2INDX[i] = i;
for (let i = 3, m = 3, k = 1; i < 256; i++) {
  NS2INDX[i] = m;
  if (--k === 0) k = ++m - 2;
}
NS2BSINDX[1] = 2;
NS2BSINDX.fill(4, 2, 11);
NS2BSINDX.fill(6, 11);
HB2FLAG.fill(8, 0x40);

export class PpmdModel extends ContextTree {
  constructor() {
    super();
    /** -1 for symbols an escape has not ruled out, 0 for masked ones. */
    this.charMask = new Int8Array(256);
    /** The states left to choose from after an escape. */
    this.escStates = new Uint32Array(256);
    this.escFreq = 0;
  }

  /**
   * Allocates `memory` bytes (reusing the buffer when the size is unchanged) and starts a fresh
   * model of `maxOrder` (2..64). Throws a RangeError for other values, or when the buffer cannot be
   * allocated.
   * @param {number} memory @param {number} maxOrder
   */
  restart(memory, maxOrder) {
    if (!Number.isInteger(maxOrder) || maxOrder < 2 || maxOrder > 64) {
      throw new RangeError(`PPMd order ${maxOrder} is not in 2..64`);
    }
    if (!Number.isInteger(memory) || memory < MIN_MEMORY || memory > MAX_MEMORY) {
      throw new RangeError(`PPMd memory ${memory} is not in ${MIN_MEMORY}..${MAX_MEMORY}`);
    }
    this.allocate(memory);
    this.maxOrder = maxOrder;
    this.restartModel();
    this.seeShift[DUMMY_SEE] = PERIOD_BITS;
    this.seeSumm[DUMMY_SEE] = 0;
    this.seeCount[DUMMY_SEE] = 64;
  }

  /**
   * One symbol 0..255 decoded from `range`, or -1 when the data is damaged. After -1 the model is
   * unusable and every call returns -1 until the next restart.
   * @param {RangeDecoder} range
   */
  decode(range) {
    const { u8, u16, u32, charMask } = this;
    let mc = this.minContext;
    if (mc === 0) return -1;
    if (u16[mc >> 1] !== 1) {
      const ns = u16[mc >> 1];
      const summFreq = u16[(mc + 2) >> 1];
      let s = u32[(mc + 4) >> 2];
      const count = range.threshold(summFreq);
      let hiCnt = u8[s + 1];
      if (count < hiCnt) {
        range.decode(0, hiCnt);
        this.foundState = s;
        const symbol = u8[s];
        this.update1First();
        return symbol;
      }
      this.prevSuccess = 0;
      let i = ns - 1;
      do {
        s += 6;
        const freq = u8[s + 1];
        hiCnt += freq;
        if (hiCnt > count) {
          range.decode(hiCnt - freq, freq);
          this.foundState = s;
          const symbol = u8[s];
          this.update1();
          return symbol;
        }
      } while (--i);
      if (count >= summFreq) return this.fail();
      this.hiBitsFlag = HB2FLAG[u8[this.foundState]];
      range.decode(hiCnt, summFreq - hiCnt);
      charMask.fill(-1);
      charMask[u8[s]] = 0;
      i = ns - 1;
      do {
        s -= 6;
        charMask[u8[s]] = 0;
      } while (--i);
    } else {
      const one = mc + 2;
      this.hiBitsFlag = HB2FLAG[u8[this.foundState]];
      const at =
        (u8[one + 1] - 1) * 64 +
        this.prevSuccess +
        NS2BSINDX[u16[u32[(mc + 8) >> 2] >> 1] - 1] +
        this.hiBitsFlag +
        2 * HB2FLAG[u8[one]] +
        ((this.runLength >> 26) & 0x20);
      const prob = this.binSumm[at];
      const count = range.threshold(BIN_SCALE);
      if (count < prob) {
        range.decode(0, prob);
        this.binSumm[at] = prob + 128 - ((prob + 32) >> 7);
        this.foundState = one;
        const symbol = u8[one];
        this.updateBin();
        return symbol;
      }
      if (count >= BIN_SCALE) return this.fail();
      range.decode(prob, BIN_SCALE - prob);
      const escaped = prob - ((prob + 32) >> 7);
      this.binSumm[at] = escaped;
      this.initEsc = EXP_ESCAPE[escaped >> 10];
      charMask.fill(-1);
      charMask[u8[one]] = 0;
      this.prevSuccess = 0;
    }
    const states = this.escStates;
    for (;;) {
      const numMasked = u16[mc >> 1];
      do {
        this.orderFall++;
        mc = u32[(mc + 8) >> 2];
        if (mc === 0) return this.fail();
      } while (u16[mc >> 1] === numMasked);
      this.minContext = mc;
      const num = u16[mc >> 1] - numMasked;
      if (num <= 0) return this.fail();
      let s = u32[(mc + 4) >> 2];
      let hiCnt = 0;
      let i = 0;
      do {
        const k = charMask[u8[s]];
        hiCnt += u8[s + 1] & k;
        states[i] = s;
        s += 6;
        i -= k;
      } while (i !== num);
      const see = this.makeEscFreq(numMasked);
      const freqSum = this.escFreq + hiCnt;
      const count = range.threshold(freqSum);
      if (count < hiCnt) {
        let j = 0;
        s = states[0];
        let high = u8[s + 1];
        while (high <= count) {
          s = states[++j];
          high += u8[s + 1];
        }
        const freq = u8[s + 1];
        range.decode(high - freq, freq);
        this.seeUpdate(see);
        this.foundState = s;
        const symbol = u8[s];
        this.update2();
        return symbol;
      }
      if (count >= freqSum) return this.fail();
      range.decode(hiCnt, freqSum - hiCnt);
      this.seeSumm[see] += freqSum;
      do charMask[u8[states[--i]]] = 0;
      while (i !== 0);
    }
  }

  /** Damaged data leaves the tree half updated: refuse to go on until a restart. */
  fail() {
    this.minContext = 0;
    this.maxContext = 0;
    return -1;
  }

  /**
   * The SEE slot for an escape from the current context after `numMasked` symbols were ruled out;
   * sets escFreq to its estimate (MakeEscFreq).
   * @param {number} numMasked
   */
  makeEscFreq(numMasked) {
    const { u16, u32 } = this;
    const mc = this.minContext;
    const ns = u16[mc >> 1];
    if (ns === 256) {
      this.escFreq = 1;
      return DUMMY_SEE;
    }
    const nonMasked = ns - numMasked;
    const suffixNs = u16[u32[(mc + 8) >> 2] >> 1];
    const see =
      NS2INDX[nonMasked - 1] * 16 +
      (nonMasked < (suffixNs - ns) >>> 0 ? 1 : 0) +
      (u16[(mc + 2) >> 1] < 11 * ns ? 2 : 0) +
      (numMasked > nonMasked ? 4 : 0) +
      this.hiBitsFlag;
    const summ = this.seeSumm[see];
    const r = summ >> this.seeShift[see];
    this.seeSumm[see] = summ - r;
    this.escFreq = r === 0 ? 1 : r;
    return see;
  }

  /** @param {number} see */
  seeUpdate(see) {
    const shift = this.seeShift[see];
    if (shift >= PERIOD_BITS) return;
    const count = (this.seeCount[see] - 1) & 0xff;
    this.seeCount[see] = count;
    if (count !== 0) return;
    this.seeSumm[see] <<= 1;
    this.seeCount[see] = 3 << shift;
    this.seeShift[see] = shift + 1;
  }

  /** After the first state of a context matched (Update1_0). */
  update1First() {
    const { u8, u16 } = this;
    const s = this.foundState;
    const sumAt = (this.minContext + 2) >> 1;
    this.prevSuccess = 2 * u8[s + 1] > u16[sumAt] ? 1 : 0;
    this.runLength = (this.runLength + this.prevSuccess) | 0;
    u16[sumAt] += 4;
    u8[s + 1] += 4;
    if (u8[s + 1] > MAX_FREQ) this.rescale();
    this.nextContext();
  }

  /** After another state of a context matched (Update1). */
  update1() {
    const { u8, u16 } = this;
    let s = this.foundState;
    u8[s + 1] += 4;
    u16[(this.minContext + 2) >> 1] += 4;
    if (u8[s + 1] > u8[s - 5]) {
      swapStates(u16, s, s - 6);
      s -= 6;
      this.foundState = s;
      if (u8[s + 1] > MAX_FREQ) this.rescale();
    }
    this.nextContext();
  }

  /** After the state of a binary context matched (UpdateBin). */
  updateBin() {
    const u8 = this.u8;
    const s = this.foundState;
    if (u8[s + 1] < 128) u8[s + 1]++;
    this.prevSuccess = 1;
    this.runLength = (this.runLength + 1) | 0;
    this.nextContext();
  }

  /** After a state matched past an escape (Update2). */
  update2() {
    const u8 = this.u8;
    const s = this.foundState;
    this.u16[(this.minContext + 2) >> 1] += 4;
    u8[s + 1] += 4;
    if (u8[s + 1] > MAX_FREQ) this.rescale();
    this.runLength = this.initRL;
    this.updateModel();
  }

  nextContext() {
    const c = successorOf(this.u16, this.foundState);
    if (this.orderFall === 0 && c > this.text) {
      this.minContext = c;
      this.maxContext = c;
    } else this.updateModel();
  }
}
